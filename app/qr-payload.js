// Formatos de contenido de un block QR: arma y vuelve a leer el texto que
// codifica el símbolo para los tipos que un teléfono sabe usar — red Wi-Fi,
// contacto, correo, llamada, SMS, ubicación y evento. ISO/IEC 18004 solo
// estandariza el símbolo, no el contenido; cada tipo sigue la norma o la
// convención que leen las cámaras de iOS y Android:
//   Wi-Fi     WIFI:T:…;S:…;P:…;;          convención de ZXing, recogida en WPA3
//   contacto  vCard 3.0                   RFC 2426
//   correo    mailto:                     RFC 6068
//   llamada   tel:                        RFC 3966
//   SMS       SMSTO:número:mensaje        convención de ZXing
//   ubicación geo:lat,lng                 RFC 5870
//   evento    VEVENT                      RFC 5545
//
// En el block solo se guarda el texto final (payload.value), así que el
// esquema, la exportación y los QR ya guardados no cambian. Al editar, parse()
// reconstruye el formulario, y solo acepta un tipo si volver a armarlo da
// exactamente el mismo texto: lo que no encaja se abre como texto libre en vez
// de perder datos en silencio.
//
// Sin JSX ni UI: se expone como window.QRPayload y para los tests de Node, igual
// que zone-tree.js.
(function () {
  const TYPES = ["text", "wifi", "contact", "email", "phone", "sms", "location", "event"];
  const CRLF = "\r\n";

  const EMPTY = {
    text: () => ({ text: "" }),
    wifi: () => ({ ssid: "", auth: "WPA", password: "", hidden: false }),
    contact: () => ({ firstName: "", lastName: "", org: "", phone: "", email: "", url: "" }),
    email: () => ({ to: "", subject: "", body: "" }),
    phone: () => ({ number: "" }),
    sms: () => ({ number: "", message: "" }),
    location: () => ({ lat: "", lng: "" }),
    event: () => ({ title: "", start: "", end: "", location: "" }),
  };
  const emptyFields = type => (EMPTY[type] || EMPTY.text)();

  const str = value => (value == null ? "" : String(value));
  const compact = value => str(value).replace(/\s+/g, "");

  // Wi-Fi escapa \ ; , : " con barra invertida. Una sola pasada con la barra
  // dentro de la clase, así una barra ya escapada no se vuelve a escapar.
  const escapeWifi = value => str(value).replace(/[\\;,:"]/g, ch => `\\${ch}`);
  // Texto de vCard/iCalendar: \ ; , y los saltos de línea.
  const escapeText = value => str(value).replace(/\\|;|,|\r?\n/g, ch => (ch === "\\" ? "\\\\" : ch === ";" ? "\\;" : ch === "," ? "\\," : "\\n"));
  const unescapeText = value => str(value).replace(/\\(.)/g, (_, ch) => (ch === "n" || ch === "N" ? "\n" : ch));
  const unescapeWifi = value => str(value).replace(/\\(.)/g, "$1");

  // Parte en cada separador que no vaya escapado, sin tocar los escapes.
  function splitUnescaped(value, separator) {
    const parts = [];
    let current = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\" && i + 1 < value.length) { current += ch + value[i + 1]; i++; continue; }
      if (ch === separator) { parts.push(current); current = ""; continue; }
      current += ch;
    }
    parts.push(current);
    return parts;
  }

  const DECIMAL = /^-?\d+(\.\d+)?$/;
  const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  // datetime-local → hora flotante de iCalendar (sin zona): cada teléfono la
  // lee en su propia zona horaria, igual que la ve quien la escribe.
  const toIcalDate = value => {
    const match = LOCAL_DATETIME.exec(str(value));
    return match ? `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}00` : "";
  };
  const fromIcalDate = value => {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})00$/.exec(str(value));
    return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}` : null;
  };

  // Lo que impide armar el contenido, o null. "required" no se muestra: el botón
  // de guardar desactivado ya lo dice. Los demás sí merecen un aviso.
  function problem(type, fields = {}) {
    switch (type) {
      case "text": return str(fields.text).trim() ? null : "required";
      case "wifi":
        if (!str(fields.ssid)) return "required";
        return fields.auth !== "nopass" && !str(fields.password) ? "required" : null;
      case "contact": return [fields.firstName, fields.lastName, fields.org].some(v => str(v).trim()) ? null : "required";
      case "email": return str(fields.to).trim() ? null : "required";
      case "phone": return compact(fields.number) ? null : "required";
      case "sms": return compact(fields.number) ? null : "required";
      case "location": {
        const lat = str(fields.lat).trim(); const lng = str(fields.lng).trim();
        if (!lat || !lng) return "required";
        if (!DECIMAL.test(lat) || !DECIMAL.test(lng) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) return "invalidCoordinates";
        return null;
      }
      case "event": {
        if (!str(fields.title).trim() || !toIcalDate(fields.start)) return "required";
        if (str(fields.end) && !toIcalDate(fields.end)) return "required";
        return str(fields.end) && toIcalDate(fields.end) < toIcalDate(fields.start) ? "endBeforeStart" : null;
      }
      default: return "required";
    }
  }

  // El texto que se codifica, o "" mientras falte algo.
  function build(type, fields = {}) {
    if (problem(type, fields)) return "";
    switch (type) {
      case "text": return str(fields.text);
      case "wifi": {
        const auth = ["WPA", "WEP", "nopass"].includes(fields.auth) ? fields.auth : "WPA";
        return `WIFI:T:${auth};S:${escapeWifi(fields.ssid)};${auth === "nopass" ? "" : `P:${escapeWifi(fields.password)};`}${fields.hidden ? "H:true;" : ""};`;
      }
      case "contact": {
        const first = str(fields.firstName).trim(); const last = str(fields.lastName).trim(); const org = str(fields.org).trim();
        const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escapeText(last)};${escapeText(first)};;;`, `FN:${escapeText([first, last].filter(Boolean).join(" ") || org)}`];
        if (org) lines.push(`ORG:${escapeText(org)}`);
        if (compact(fields.phone)) lines.push(`TEL:${compact(fields.phone)}`);
        if (str(fields.email).trim()) lines.push(`EMAIL:${str(fields.email).trim()}`);
        if (str(fields.url).trim()) lines.push(`URL:${escapeText(str(fields.url).trim())}`);
        lines.push("END:VCARD");
        return lines.join(CRLF);
      }
      case "email": {
        const params = [["subject", fields.subject], ["body", fields.body]]
          .filter(([, value]) => str(value))
          .map(([key, value]) => `${key}=${encodeURIComponent(str(value))}`);
        return `mailto:${str(fields.to).trim()}${params.length ? `?${params.join("&")}` : ""}`;
      }
      case "phone": return `tel:${compact(fields.number)}`;
      case "sms": return `SMSTO:${compact(fields.number)}${str(fields.message) ? `:${str(fields.message)}` : ""}`;
      case "location": return `geo:${str(fields.lat).trim()},${str(fields.lng).trim()}`;
      case "event": {
        const lines = ["BEGIN:VEVENT", `SUMMARY:${escapeText(str(fields.title).trim())}`, `DTSTART:${toIcalDate(fields.start)}`];
        if (str(fields.end)) lines.push(`DTEND:${toIcalDate(fields.end)}`);
        if (str(fields.location).trim()) lines.push(`LOCATION:${escapeText(str(fields.location).trim())}`);
        lines.push("END:VEVENT");
        return lines.join(CRLF);
      }
      default: return "";
    }
  }

  // Cada lector devuelve los campos si reconoce el formato, o null.
  const READERS = {
    wifi(value) {
      if (!value.startsWith("WIFI:")) return null;
      const fields = emptyFields("wifi");
      for (const raw of splitUnescaped(value.slice(5), ";")) {
        if (!raw) continue;
        const colon = raw.indexOf(":");
        if (colon < 1) return null;
        const key = raw.slice(0, colon); const content = unescapeWifi(raw.slice(colon + 1));
        if (key === "T") fields.auth = content;
        else if (key === "S") fields.ssid = content;
        else if (key === "P") fields.password = content;
        else if (key === "H") fields.hidden = content === "true";
        else return null;
      }
      return fields;
    },
    contact(value) {
      const lines = value.split(CRLF);
      if (lines[0] !== "BEGIN:VCARD" || lines[lines.length - 1] !== "END:VCARD") return null;
      const fields = emptyFields("contact");
      for (const line of lines.slice(1, -1)) {
        const colon = line.indexOf(":");
        if (colon < 1) return null;
        const key = line.slice(0, colon); const content = line.slice(colon + 1);
        if (key === "VERSION" || key === "FN") continue;
        if (key === "N") {
          const [last = "", first = ""] = splitUnescaped(content, ";");
          fields.lastName = unescapeText(last); fields.firstName = unescapeText(first);
        } else if (key === "ORG") fields.org = unescapeText(content);
        else if (key === "TEL") fields.phone = content;
        else if (key === "EMAIL") fields.email = content;
        else if (key === "URL") fields.url = unescapeText(content);
        else return null;
      }
      return fields;
    },
    email(value) {
      if (!value.startsWith("mailto:")) return null;
      const [to, query = ""] = value.slice(7).split(/\?(.*)/s);
      const fields = { ...emptyFields("email"), to };
      if (!query) return fields;
      for (const pair of query.split("&")) {
        const [key, raw = ""] = pair.split(/=(.*)/s);
        if (key !== "subject" && key !== "body") return null;
        try { fields[key] = decodeURIComponent(raw); } catch { return null; }
      }
      return fields;
    },
    phone: value => (value.startsWith("tel:") ? { number: value.slice(4) } : null),
    sms(value) {
      if (!value.startsWith("SMSTO:")) return null;
      const [number, message = ""] = value.slice(6).split(/:(.*)/s);
      return { number, message };
    },
    location(value) {
      const match = /^geo:([^,]+),([^,]+)$/.exec(value);
      return match ? { lat: match[1], lng: match[2] } : null;
    },
    event(value) {
      const lines = value.split(CRLF);
      if (lines[0] !== "BEGIN:VEVENT" || lines[lines.length - 1] !== "END:VEVENT") return null;
      const fields = emptyFields("event");
      for (const line of lines.slice(1, -1)) {
        const colon = line.indexOf(":");
        if (colon < 1) return null;
        const key = line.slice(0, colon); const content = line.slice(colon + 1);
        if (key === "SUMMARY") fields.title = unescapeText(content);
        else if (key === "DTSTART" || key === "DTEND") {
          const date = fromIcalDate(content);
          if (date === null) return null;
          fields[key === "DTSTART" ? "start" : "end"] = date;
        } else if (key === "LOCATION") fields.location = unescapeText(content);
        else return null;
      }
      return fields;
    },
  };

  function parse(value) {
    const text = str(value);
    for (const type of TYPES) {
      if (type === "text") continue;
      const fields = READERS[type](text);
      if (fields && build(type, fields) === text) return { type, fields };
    }
    return { type: "text", fields: { text } };
  }

  const api = { TYPES, emptyFields, build, parse, problem };
  if (typeof window !== "undefined") window.QRPayload = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
