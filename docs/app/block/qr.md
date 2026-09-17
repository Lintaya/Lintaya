# QR codes

English | [Español](qr.es.md)

A QR block turns content into a code a phone can scan. Beyond a link, it can
join a Wi-Fi network, save a contact, start an email, a call or an SMS, open a
location, or add a calendar event. You fill in ordinary fields and Lintaya
writes the text each phone expects. For blocks in general, see
[Blocks](introduccion.md).

## Static and dynamic

A **static** code stores its content inside the symbol. It works offline and
never depends on Lintaya, but changing the content means printing a new code.
Every content type on this page is static.

A **dynamic** code stores a short link served by Lintaya, and you can change
where it points without reprinting. It is always a URL, so it has no content
type. Enable it in **Settings → Builder** and set a public base URL first;
otherwise a phone outside your network cannot open it.

## Content types

ISO/IEC 18004 standardises the QR symbol itself — modules, encoding and error
correction — but not what the text means. Each type follows the standard or
convention that the camera apps on iOS and Android read:

| Type | What the phone does | Standard | Starts with |
|---|---|---|---|
| Text or URL | Shows the text or opens the link | Free text; URLs per RFC 3986 | anything |
| Wi-Fi | Offers to join the network | ZXing convention, referenced by WPA3 | `WIFI:` |
| Contact | Offers to save the contact | vCard 3.0, RFC 2426 | `BEGIN:VCARD` |
| Email | Opens a new message | `mailto:` URI, RFC 6068 | `mailto:` |
| Call | Offers to dial the number | `tel:` URI, RFC 3966 | `tel:` |
| SMS | Opens a new text message | ZXing convention | `SMSTO:` |
| Location | Opens the maps app | `geo:` URI, RFC 5870 | `geo:` |
| Event | Offers to add it to the calendar | iCalendar `VEVENT`, RFC 5545 | `BEGIN:VEVENT` |

Payment codes follow the EMVCo QR Code Specification for Payment Systems. That
content is issued by your bank or payment provider, so Lintaya does not build
it; paste it as **Text or URL** if you have one.

## Each format

### Text or URL

The content is encoded exactly as typed. Use it for links and for any format
this page does not list.

```text
https://lintaya.com
```

### Wi-Fi

```text
WIFI:T:WPA;S:Office;P:correct-horse;;
```

- **Network name (SSID)** goes in `S`.
- **Security** goes in `T`: `WPA` covers WPA, WPA2 and WPA3; `WEP` is legacy;
  `nopass` is an open network and leaves the password out.
- **Password** goes in `P`, and **Hidden network** adds `H:true`.
- A backslash, `;`, `,`, `:` or `"` in the name or password is written with a
  backslash in front, so `Office;North` becomes `Office\;North`. Lintaya does
  this for you.

The password is readable by anyone who scans or photographs the code — the
format has no way to hide it — and it is stored with the block. Print it only
where anyone who can see it may join. The WPA3 text asks for percent-encoding
while Android uses backslashes; Lintaya follows Android, which is what phones
actually read.

### Contact

```text
BEGIN:VCARD
VERSION:3.0
N:Pérez;Ana;;;
FN:Ana Pérez
ORG:Lintaya
TEL:+525512345678
EMAIL:ana@example.com
URL:https://lintaya.com
END:VCARD
```

At least a first name, a last name or a company is required. Lines end in CRLF,
as the RFC requires, and spaces are removed from the phone number.

### Email

```text
mailto:ana@example.com?subject=Hello&body=See%20you%20soon
```

The subject and body are optional and percent-encoded.

### Call

```text
tel:+525512345678
```

Write the number with its country code so it works from any country.

### SMS

```text
SMSTO:+525512345678:See you at 10:30
```

The message is optional and may contain colons.

### Location

```text
geo:19.4326,-99.1332
```

Latitude runs from -90 to 90 and longitude from -180 to 180, in decimal
degrees.

### Event

```text
BEGIN:VEVENT
SUMMARY:Launch
DTSTART:20260920T180000
DTEND:20260920T200000
LOCATION:Office
END:VEVENT
```

A title and a start are required; the end cannot come before the start. Times
carry no time zone, so each phone reads them in its own: an event created in
Mexico City at 18:00 shows as 18:00 on a phone set to Madrid.

## Logo and density

The logo sits on an opaque plate in the centre and never covers the finder,
timing or alignment patterns. Error correction is chosen automatically and a
code with a logo always uses the highest level.

In versions 7–13, 21–27, 35, 37, 38 and 40 the standard places an alignment
pattern exactly in the centre, so no centred logo fits however small it is.
Longer content — an event, a contact — often lands there. Lintaya then moves the
code to the next version with a free centre: the same content in a denser grid,
for example 73×73 modules instead of 57×57. The builder says when this happens;
print that code a little larger or turn the logo off. Only a version 40 code,
which has nowhere to move, is generated without the logo.

Scan a code with a real phone before printing it.

## Editing a saved code

Only the final text is saved. When you edit a block, the builder reads that
text back into the form. It accepts a type only if rebuilding it produces
exactly the same text; anything else — for example a vCard written elsewhere
with extra fields — opens as **Text or URL**, so no content is lost.

## Create a QR code with the Assistant

The Assistant can create static QR blocks of every type on this page:

- Ask for it in plain words, for example "a QR code for the office Wi-Fi".
- The Assistant fills the fields and asks for anything missing, such as a
  password or an event start. It never writes the `WIFI:` or vCard text itself;
  Lintaya builds it from the fields.
- Nothing is created until you approve the proposal in the chat or the Approval
  Center.
- When the Assistant lists your blocks it sees each QR code's type, never its
  content, so a Wi-Fi password is not sent to the model provider.

Dynamic codes are created from **Blocks → + New block** only. Agents that
connect over HTTP learn that Lintaya builds QR codes, and in which formats, from
the public `GET /api/ai-context` endpoint.

## References

- [ISO/IEC 18004:2024, QR code symbology](https://www.iso.org/standard/83389.html)
- [RFC 2426, vCard 3.0](https://www.rfc-editor.org/rfc/rfc2426)
- [RFC 3966, the tel URI](https://www.rfc-editor.org/rfc/rfc3966)
- [RFC 3986, URI syntax](https://www.rfc-editor.org/rfc/rfc3986)
- [RFC 5545, iCalendar](https://www.rfc-editor.org/rfc/rfc5545)
- [RFC 5870, the geo URI](https://www.rfc-editor.org/rfc/rfc5870)
- [RFC 6068, the mailto URI](https://www.rfc-editor.org/rfc/rfc6068)
- [EMVCo QR Code Specification for Payment Systems](https://www.emvco.com/emv-technologies/qr-codes/)
