// The MIT License (MIT)

// Copyright (c) 2024 Christoph Stade

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

/**
* @file Module exposing generator function to create current view of Thing Description document with available affordances based on property values of Thing and preconditions described in an RDF Protocol State Machine.
* @author Christoph Stade <christoph-stade@outlook.de>
* @copyright Christoph Stade 2024
* @license MIT
*/

const fusekiDatasetURL = "http://localhost:3030/lampPSM"
const operatorMappings = {
    "https://openmath.org/cd/logic1#and": "&&",
    "https://openmath.org/cd/logic1#or": "||",
    "https://openmath.org/cd/relation1#eq": "==",
    "https://openmath.org/cd/relation1#leq": "<=",
    "https://openmath.org/cd/relation1#lt": "<",
    "https://openmath.org/cd/relation1#geq": ">=",
    "https://openmath.org/cd/relation1#gt": ">",
    // ...
}

/**
 * Extracts triggers and pre/postcondition guards of transition of Protocol State Machine in Turtle format.
 * @param {string} psm Protocol State Machine in RDF Turtle format.
 * @returns {Object} Object listing both guards for all transitions of every affordance.
*/
async function extractGuards() {
    let groupedGuards = {} 

    let simpleQuery = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> 
        PREFIX td: <https://www.w3.org/2019/wot/td#> 
        PREFIX psm: <http://psm.com/> 
        
        SELECT DISTINCT ?transition ?trigger ?triggerForm ?triggerFormHref ?precondition ?postcondition
        WHERE {
            ?transition rdf:type psm:ProtocolTransition .
            ?transition psm:hasTrigger ?trigger .
            ?trigger td:hasForm ?triggerForm .
            ?triggerForm td:href ?triggerFormHref .

            ?transition psm:hasPrecondition ?precondition .
            ?transition psm:hasPostcondition ?postcondition .
        }
    `

    let queriedTriples = await fetch(`${fusekiDatasetURL}?query=${encodeURIComponent(simpleQuery)}`)
        .then(res => res.text())
        .then(res => JSON.parse(res))
        .then(res => res.results.bindings)

    // Group GuardPairs (Transitions) to Affordance (Trigger)
    for (const triple of queriedTriples) {
        let affordance = triple.triggerFormHref.value
        let transition = triple.transition.value 
        let precondition = triple.precondition.value  
        let postcondition = triple.postcondition.value
        let expression = undefined

        // Create new list of guardPairs for new Affordance
        if (!(affordance in groupedGuards)) {  
            groupedGuards[affordance] = {}
        }
        
        if (!(transition in groupedGuards[affordance])) {  
            groupedGuards[affordance][transition] = {}
        }

        let guards = { 
            "http://psm.com/hasPrecondition": precondition, 
            "http://psm.com/hasPostcondition": postcondition 
        }
        
        for (const guardRelation in guards) {
            if (guards[guardRelation] == "true"){
                expression = "true" // "empty" guard. Always enabling
            } else {
                expression = await unpackExpression(guardRelation, transition)
            }
    
            groupedGuards[affordance][transition][guardRelation] = expression
        }
    }

    return groupedGuards
}

/**
 * Gathers all triples connected to a root guard and builds a mathematical expression of the relevant OpenMath components. 
 * @param {String} guardRelation Pre- or postcondition IRI.
 * @param {String} transition Transition IRI.
 * @returns {String} Expression string.
 */
async function unpackExpression(guardRelation, transition) {
    let simpleQuery = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        PREFIX math: <http://openmath.org/vocab/math#>
        PREFIX psm: <http://psm.com/> 
        PREFIX td: <https://www.w3.org/2019/wot/td#> 

        SELECT ?guard ?arg ?operator ?argNested ?first ?rest ?firstOfRest ?firstForm ?firstFormHref ?firstOfRestForm ?firstOfRestFormHref
        WHERE {
            <${transition}> <${guardRelation}> ?guard .  
            ?guard (math:arguments|math:symbol|math:operator|math:target|math:variables|math:binder|math:body|math:attributeKey|math:attributeValue|rdf:rest|rdf:first)* ?arg .
            ?arg math:arguments ?argNested .
            ?arg math:operator ?operator .

            ?argNested rdf:first ?first .
            ?argNested rdf:rest ?rest .
            ?rest rdf:first ?firstOfRest .

            OPTIONAL {
                ?first rdf:type td:PropertyAffordance . 
                ?first td:hasForm ?firstForm .
                ?firstForm td:href ?firstFormHref .
    
            }
            OPTIONAL {
                ?firstOfRest rdf:type td:PropertyAffordance . 
                ?firstOfRest td:hasForm ?firstOfRestForm .
                ?firstOfRestForm td:href ?firstOfRestFormHref .
            }
        }
    `
    
    let queriedTriples = await fetch(`${fusekiDatasetURL}?query=${encodeURIComponent(simpleQuery)}`)
        .then(res => res.text())
        .then(res => JSON.parse(res))
        .then(res => res.results.bindings)

    let root = undefined
    
    for (const triple of queriedTriples) {
        if (triple.guard.value == triple.arg.value) {
            root = triple
            break
        }
    }

    async function resolveTriple(triple, allTriples) {
        if (typeof(triple) != 'object') return "'" + triple + "'" // literal

        let a = triple.first.value
        let b = triple.firstOfRest.value 
        let op = operatorMappings[triple.operator.value]

        if ("firstFormHref" in triple) { // Replace affordance blank node with form
            a = triple.firstFormHref.value
        }
        if ("firstOfRestFormHref" in triple) { // Replace affordance blank node with form
            b = triple.firstOfRestFormHref.value
        }

        if (triple.first.type == 'bnode') { // blank node as Variable handled by fetch
            for (const nextTriple of allTriples) {  // blank node was rdf:list
                if(nextTriple.arg.value == a){
                    a = nextTriple
                    break
                }
            }
        }
        if (triple.firstOfRest.type == 'bnode') {
            for (const nextTriple of allTriples) {
                if(nextTriple.arg.value == b){
                    b = nextTriple
                    break
                }
            }
        }
        
        return "(" + await resolveTriple(a, allTriples) + op + await resolveTriple(b, allTriples) + ")"
    }

    return resolveTriple(root, queriedTriples)
}

/**
 * Evaluates precondition guards against values of property affordances and extract corresponding available affordances with their postcondition. 
 * @param {Object} allAffordances All affordances with their transitions and both guards.
 * @returns {Object} All affordances currently available and their postconditions.
 */
async function evaluateGuards(allAffordances) {
    let availableAffordances = {}

    for (const affordance in allAffordances) {        
        for (const transition in allAffordances[affordance]) {
            let preconditionExpression = allAffordances[affordance][transition]['http://psm.com/hasPrecondition']
            
            for (const subString of preconditionExpression.split("'")) {
                if (subString.startsWith("http://")){
                    await fetch(subString)
                        .then(res => res.text())
                        .then(res => {
                            preconditionExpression = preconditionExpression.replace(subString, res)
                        })
                }
            }

            // Preconditions holds
            if (eval(preconditionExpression)) { 
                if (!(affordance in availableAffordances)) {  
                    availableAffordances[affordance] = {}
                }

                availableAffordances[affordance][transition] = allAffordances[affordance][transition]['http://psm.com/hasPostcondition']
            }
        }
    }
    
    return availableAffordances
}


/**
 * Builds state specific view of TD
 * @param {Object} thingDescription Thing Description document of Thing in JSON-LD format.
 * @param {Object} availableAffordances  All affordances currently available and their postconditions.
 * @returns {Object} Current view of Thing Description document of Thing in JSON-LD format.
*/
function build(thingDescription, availableAffordances) {
    console.log(availableAffordances)
    let subTD = thingDescription
    let availableInteractionAffordances = {
        properties: {},
        actions: {},
        events: {}
    }

    for (const affordanceURL in availableAffordances) {
        let affordanceKey = affordanceURL.split("/").slice(-1)[0]
        let affordanceType = ""

        affordanceKey = affordanceKey.replace("Write", "")

        if (affordanceKey in thingDescription.properties) {
            affordanceType = "properties"
        }

        if (affordanceKey in thingDescription.actions) { 
            affordanceType = "actions"
        }

        if (affordanceKey in thingDescription.events) { 
            affordanceType = "events"
        }

        let affordance = thingDescription[affordanceType][affordanceKey]
        affordance.postconditions = availableAffordances[affordanceURL]  // add postconditions to affordance information

        availableInteractionAffordances[affordanceType][affordanceKey] = affordance
    }

    // Make unavailable property affordances readonly, i.e. those that can't be written
    for (const property in thingDescription.properties) {
        if (!(property in availableInteractionAffordances.properties)) {
            let prop = thingDescription.properties[property]
            prop.readOnly = true
            availableInteractionAffordances.properties[property] = prop
        } else {
            availableInteractionAffordances.properties[property].readOnly = false
        }
    }

    subTD.properties = availableInteractionAffordances.properties
    subTD.actions = availableInteractionAffordances.actions
    subTD.events = availableInteractionAffordances.events

    return subTD
}


module.exports = {
    /**
     * Creates current view of Thing Description document with available affordances based on property values of Thing and preconditions described in an RDF Protocol State Machine.
     * @param {Object} thingDescription Thing Description document of Thing in JSON-LD format.
     * @returns {Object} Current view of Thing Description document of Thing in JSON-LD format.
     */
    generate: async function(thingDescription) {
        let allAffordances = await extractGuards()
        let availableAffordances = await evaluateGuards(allAffordances)
        let subTD = build(thingDescription, availableAffordances)

        return JSON.stringify(subTD)
    }
};
