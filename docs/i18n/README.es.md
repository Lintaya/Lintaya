# Documentación bilingüe

[English](README.md) | Español

La documentación de Lintaya se mantiene en inglés y español. Ambos idiomas
tienen la misma autoridad: una actualización puede empezar en cualquiera de
ellos, pero su contraparte debe expresar el mismo comportamiento, advertencia,
requisito previo, ejemplo y alcance.

## Contrato de pares

Cada documento dentro del alcance es un conjunto de tres archivos hermanos:

```text
foo.md             English
foo.es.md          Español
foo.i18n.yaml      last confirmed-consistent hashes
```

El archivo `.i18n.yaml` registra el hash Git de cada documento después de que
una persona o revisor confirma que ambos son equivalentes. No traduce texto ni
demuestra por sí solo la calidad semántica; hace visible una edición sin su
contraparte durante la revisión y en CI.

Después de modificar un par, actualiza ambos documentos y registra el estado
revisado:

```powershell
node scripts/verify-translation-pairing.mjs --write docs/example.md
node scripts/verify-translation-pairing.mjs docs/example.md
```

Ejecuta el comando sin una ruta para revisar todo el corpus. `--all` es
obligatorio para volver a registrar deliberadamente todo el corpus.

Durante la migración, CI ejecuta `--recorded`: todo par que tiene registro
`.i18n.yaml` se exige automáticamente, mientras los documentos que esperan su
primera traducción siguen visibles en `--list`. Cuando cada documento tenga
par, CI debe cambiar al comando de corpus completo sin ruta.

## Qué valida el verificador

- Archivos completos en inglés, español y de registro.
- Selectores de idioma inmediatamente debajo del título.
- Hashes Git registrados.
- Niveles de headings, bloques de código fenced, forma de listas, forma de
  tablas y destinos semánticos de enlaces Markdown equivalentes.

El verificador no decide si una traducción es correcta. Los revisores usan las
[reglas de traducción](translation-rules.es.md) y la tabla de
[terminología](terminology.md) para ese juicio.

## Alcance

Toda la documentación Markdown del repositorio está dentro del alcance,
incluidas las guías raíz, `docs/`, `cli/`, `server/`, los README de conectores,
los README de assets y las guías para agentes. La única exclusión actual es
`terminology.md`, que es bilingüe por construcción. Las exclusiones viven en
[`scripts/translation-pairing.manifest.json`](../../scripts/translation-pairing.manifest.json)
y deben ser explícitas.
