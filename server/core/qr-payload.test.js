const test = require("node:test");
const assert = require("node:assert/strict");
const QRPayload = require("../../app/qr-payload.js");

const { build, parse, problem, emptyFields, TYPES } = QRPayload;

test("Wi-Fi payload escapes every special character, backslash included, in one pass", () => {
  const value = build("wifi", { ssid: 'Casa;"Norte"', auth: "WPA", password: "a\\b:c,d;e", hidden: false });
  assert.equal(value, 'WIFI:T:WPA;S:Casa\\;\\"Norte\\";P:a\\\\b\\:c\\,d\\;e;;');
  assert.deepEqual(parse(value), { type: "wifi", fields: { ssid: 'Casa;"Norte"', auth: "WPA", password: "a\\b:c,d;e", hidden: false } });
});

test("an open Wi-Fi network carries no password field, and a hidden one says so", () => {
  assert.equal(build("wifi", { ssid: "Invitados", auth: "nopass", password: "ignorada", hidden: true }), "WIFI:T:nopass;S:Invitados;H:true;;");
  assert.equal(build("wifi", { ssid: "Casa", auth: "WPA", password: "" }), "", "a secured network needs its password");
  assert.equal(build("wifi", { ssid: "", auth: "nopass" }), "");
});

test("a contact is a vCard 3.0 with CRLF lines and escaped text", () => {
  const value = build("contact", { firstName: "Ana", lastName: "Pérez; Gómez", org: "Lintaya, S.A.", phone: "+52 55 1234 5678", email: "ana@lintaya.com", url: "" });
  assert.equal(value, [
    "BEGIN:VCARD", "VERSION:3.0", "N:Pérez\\; Gómez;Ana;;;", "FN:Ana Pérez\\; Gómez",
    "ORG:Lintaya\\, S.A.", "TEL:+525512345678", "EMAIL:ana@lintaya.com", "END:VCARD",
  ].join("\r\n"));
  assert.equal(parse(value).type, "contact");
  assert.equal(parse(value).fields.lastName, "Pérez; Gómez");
});

test("a vCard this form did not write opens as free text instead of losing data", () => {
  const foreign = ["BEGIN:VCARD", "VERSION:3.0", "N:Pérez;Ana;;;", "FN:Ana Pérez", "TEL;TYPE=CELL:+525512345678", "END:VCARD"].join("\r\n");
  assert.deepEqual(parse(foreign), { type: "text", fields: { text: foreign } });
});

test("email, call and SMS use their URI forms", () => {
  assert.equal(build("email", { to: "ana@lintaya.com", subject: "Hola & adiós", body: "" }), "mailto:ana@lintaya.com?subject=Hola%20%26%20adi%C3%B3s");
  assert.equal(build("phone", { number: "+52 55 1234 5678" }), "tel:+525512345678");
  assert.equal(build("sms", { number: "+52 55 1234", message: "Llego a las 10:30" }), "SMSTO:+52551234:Llego a las 10:30");
  assert.deepEqual(parse("SMSTO:+52551234:Llego a las 10:30").fields, { number: "+52551234", message: "Llego a las 10:30" });
});

test("a location rejects coordinates outside the globe", () => {
  assert.equal(build("location", { lat: "19.4326", lng: "-99.1332" }), "geo:19.4326,-99.1332");
  assert.equal(problem("location", { lat: "91", lng: "0" }), "invalidCoordinates");
  assert.equal(problem("location", { lat: "norte", lng: "0" }), "invalidCoordinates");
  assert.equal(build("location", { lat: "91", lng: "0" }), "");
});

test("an event stores floating local times and refuses to end before it starts", () => {
  const value = build("event", { title: "Lanzamiento, v1", start: "2026-09-20T18:00", end: "2026-09-20T20:30", location: "Oficina" });
  assert.equal(value, ["BEGIN:VEVENT", "SUMMARY:Lanzamiento\\, v1", "DTSTART:20260920T180000", "DTEND:20260920T203000", "LOCATION:Oficina", "END:VEVENT"].join("\r\n"));
  assert.deepEqual(parse(value).fields, { title: "Lanzamiento, v1", start: "2026-09-20T18:00", end: "2026-09-20T20:30", location: "Oficina" });
  assert.equal(problem("event", { title: "X", start: "2026-09-20T18:00", end: "2026-09-20T17:00" }), "endBeforeStart");
});

test("plain URLs and text stay free text", () => {
  for (const value of ["https://lintaya.com", "Hola mundo", "WIFI:roto", "geo:1,2,3", ""]) {
    assert.equal(parse(value).type, "text", value);
  }
});

test("every type round-trips through the text it builds", () => {
  const samples = {
    text: { text: "https://lintaya.com/é" },
    wifi: { ssid: "Red\\Rara", auth: "WEP", password: "x:y", hidden: true },
    contact: { firstName: "Ana", lastName: "", org: "", phone: "", email: "", url: "https://lintaya.com" },
    email: { to: "ana@lintaya.com", subject: "", body: "Línea 1\nLínea 2" },
    phone: { number: "+525512345678" },
    sms: { number: "+525512345678", message: "" },
    location: { lat: "-33.8688", lng: "151.2093" },
    event: { title: "Reunión", start: "2026-12-31T23:00", end: "", location: "" },
  };
  assert.deepEqual(Object.keys(samples), TYPES);
  for (const type of TYPES) {
    const value = build(type, samples[type]);
    assert.ok(value, `${type} builds`);
    const parsed = parse(value);
    assert.equal(parsed.type, type, `${type} is recognised`);
    assert.equal(build(type, parsed.fields), value, `${type} rebuilds the same text`);
    assert.deepEqual(Object.keys(parsed.fields).sort(), Object.keys(emptyFields(type)).sort(), `${type} keeps its field set`);
  }
});
