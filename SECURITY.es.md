# Política de seguridad

[English](SECURITY.md) | Español

Lintaya maneja credenciales de repositorios, clones locales e integraciones de
infraestructura. Trata todo repositorio, respuesta de conector y archivo
importado como entrada no confiable.

## Versiones soportadas

Lintaya se encuentra actualmente en pre-release. Las correcciones de seguridad
se aplican al código más reciente en la rama predeterminada. Se agregará una
tabla de soporte de versiones con la primera versión estable.

## Reportar una vulnerabilidad

No divulgues vulnerabilidades, credenciales ni detalles de explotación en un
issue, discusión, pull request o transcripción de chat públicos.

Usa el flujo de GitHub **Report a vulnerability** / private security advisory
del repositorio. Si el reporte privado aún no está habilitado, contacta de forma
privada a las personas mantenedoras y solicita un canal seguro sin incluir
detalles de explotación en el primer mensaje.

Incluye, cuando sea posible:

- componente y versión o commit afectados;
- impacto y escenario de ataque realista;
- pasos mínimos de reproducción;
- si pudieron exponerse credenciales o datos de usuario;
- mitigación sugerida, si se conoce.

Las personas mantenedoras buscan confirmar un reporte dentro de tres días
hábiles, dar una evaluación inicial dentro de siete días hábiles y coordinar la
divulgación cuando haya una corrección disponible. Son objetivos de respuesta,
no un SLA contractual.

## Límites de seguridad

- Nunca hagas commit de archivos `.env`, exportaciones de vault, bases de datos,
  tokens o claves privadas.
- La ejecución de repositorios no se considera segura hasta que el hito de
  sandbox esté completo. No ejecutes comandos de proyectos no confiables en el
  host.
- Los secretos de conectores deben leerse a través del almacén de secretos
  configurado y nunca aparecer en respuestas API, diagnósticos o logs.
- Una credencial filtrada debe revocarse o rotarse incluso si se elimina del
  historial Git.

Se agradecen los reportes de buena fe que mejoren la seguridad de Lintaya. No
accedas a datos ajenos, interrumpas servicios ni realices ingeniería social.
