const express = require("express")
const bodyParser = require("body-parser")
const generator = require("./generator")
const fs = require("fs")
const app = express()
const port = 3001

app.use(bodyParser.text())

const colors = [
    "cold",
    "warm"
]

let initialized = true
let color = "warm"
let brightness = 0.9

const thingIP = "http://localhost:3001/"
const psm = fs.readFileSync("./lampPSM.ttl", 'UTF-8')
const td = {
    "@context": [
        "https://www.w3.org/2022/wot/td/v1.1",
        {
            "@base": `http://${thingIP}/`,
            postconditions: "https://paul.ti.rw.fau.de/~jo00defe/ont/psm#hasPostcondition", 
            effect: "https://paul.ti.rw.fau.de/~jo00defe/ont/asg#hasAssignment", 
            assign: "https://paul.ti.rw.fau.de/~jo00defe/ont/asg#hasValue", 
            to: "https://paul.ti.rw.fau.de/~jo00defe/ont/asg#hasTarget"
        },
    ],
    id: "urn:uuid:0804d572-cce8-422a-bb7c-4412fcd56f06",
    title: "myLamp",
    securityDefinitions: {
        nosec_sc: {
        scheme: "nosec",
        },
    },
    security: "nosec_sc",
    links: [
        {
            href: `http://${thingIP}/lampTD`,
            type: "application/td+json",
        },
        {
            rel: "alternate", 
            href: `http://${thingIP}/TDview`,
            type: "application/td+json",
        },
        {
            rel: "service-doc", 
            href: `http://${thingIP}/psm`,
            type: "text/turtle",
        },
    ],
    properties: {
        switchedOn: { 
            "@id": "switchedOn",
            type: "boolean",
            readOnly: true,  // only to be manipulated through action invocation
            writeOnly: false,
            forms: [{ href: `http://${thingIP}/switchedOn` }],
        },
        color: {
            "@id": "color",
            type: "string",
            "enum": ["warm", "cold"],
            readOnly: true,
            writeOnly: false,
            forms: [{ href: `http://${thingIP}/color` }],
        },
        brightness: {
            "@id": "brightness",
            type: "number", 
            readOnly: false,
            writeOnly: false,
            input: {
                "@id": "brightnessInput",
                type: "number", 
                minimum: 0.0,
                maximum: 1.0,
            },
            forms: [{ href: `http://${thingIP}/brightness` }],
            effect: [{ assign: { "@id": "brightnessInput" }, to: { "@id": "switchedOn" } }], 
        },
    },
    actions: {
        switchOn: {                                                  
            forms: [{ href: `http://${thingIP}/switchOn` }],
            effect: [
                { assign: true, to: { "@id": "switchedOn" } }, // initializes with color cold
                { assign: "cold", to: { "@id": "color" } }
            ], 
        },
        switchOff: {
            forms: [{ href: `http://${thingIP}/switchOff` }],
            effect: [{ assign: false, to: { "@id": "switchedOn" } }],
        },
        swapColor: {
            forms: [{ href: `http://${thingIP}/swapColor` }],
            effect: [{ assign: "colors[ + !colors.indexOf(color) ]", to: { "@id": "color" } }]
        },
    },
    events: {
        overheat: {
            description: "Lamp reaches a critical temperature (overheating)",
            data: {type: "string"},
            forms: [{
                href: `http:/${thingIP}/overheat`,
                subprotocol: "longpoll"
            }],
            effect: [{ assign: false, to: { "@id": "switchedOn" } }],
        }
    }
}

app.get("/lampTD", (req, res) => {
    res.setHeader("content-type", "application/td+json")
    res.send(td)
})

app.get("/TDview", (req, res) => {
    generator.generate(td).then((TDview) => {
        res.setHeader("content-type", "application/td+json")
        res.send(JSON.parse(TDview))
    })
})

app.get("/psm", (req, res) => {
    res.setHeader("content-type", "text/turtle")
    res.send(psm)
})

app.get("/switchedOn", function (req, res) {
  console.log("Read 'initialized' state of lamp")
  res.send(initialized + '')
})

app.get("/color", function (req, res) {
    console.log("Read 'color' state of lamp")
    res.send(color + '')
})

app.get("/brightness", function (req, res) {
    console.log("Read 'brightness' state of lamp")
    res.send(brightness + '')
})

app.put("/brightness", bodyParser.raw({ type: "application/json" }), function (req, res) {
    brightness = parseFloat(req.body)

    console.log("Write 'brightness' state of lamp | New brightness: ", brightness)
    res.send(200)
})

app.post("/swapColor", bodyParser.raw({ type: "application/json" }), function (req, res) {
    color = colors[
        + !colors.indexOf(color) // invert index of current color
    ]
    
    console.log("Write 'color' state of lamp | New color: ", color)
    res.send(200)
})

app.post("/switchOn", function (req, res) {
    switchedOn = true
    console.log("Action: 'switchOn' invoked of lamp | New switchedOn:", switchedOn)
    res.sendStatus(200)
})

app.post("/switchOff", function (req, res) {
    switchedOn = false
    console.log("Action: 'switchOff' invoked of lamp | New switchedOn:", switchedOn)
    res.sendStatus(200)
})

app.listen(port, () => {
  console.log(`Devices ready at port ${port}`)
})
