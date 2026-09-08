# Reglas de traducción

[English](translation-rules.md) | Español

## Fidelidad

- La contraparte debe conservar cada comportamiento de producto, requisito
  previo, advertencia, limitación, afirmación de versión y ejemplo del lado
  editado.
- Escribe prosa técnica natural en el idioma destino. Traduce el significado,
  no los modismos ni el orden de palabras.
- Si los documentos discrepan, corrige la afirmación inexacta y actualiza ambos
  documentos en el mismo cambio.

## Conservar la estructura técnica

- Conserva comandos, flags, rutas API, claves JSON, variables de entorno,
  rutas de archivos, identificadores, versiones y bloques de código idénticos
  byte por byte.
- Conserva headings, listas, tablas, enlaces y ejemplos estructuralmente
  equivalentes.
- Los enlaces ingleses apuntan a `.md`; los enlaces españoles apuntan al
  `.es.md` correspondiente cuando el documento pertenece al corpus bilingüe.

## Redacción en español

- Usa español técnico claro y neutral, adecuado para desarrolladores de
  Latinoamérica.
- Usa de manera consistente un término de [terminology.md](terminology.md).
- Conserva en inglés los nombres establecidos de producto y técnicos cuando el
  glosario lo indique; introduce un término explicativo en español solo cuando
  el glosario lo requiera.
- No repitas una aclaración inglesa después de la primera aparición necesaria.

## Revisión

El script de pares detecta divergencias mecánicas. Un revisor todavía debe
confirmar significado, terminología, advertencias de seguridad, comandos y
ejemplos antes de ejecutar `--write` para un par.
