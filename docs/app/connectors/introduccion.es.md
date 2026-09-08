# Conectores

[English](introduccion.md) | Español

Un ConnectorType es una integración de producto registrada desde un manifiesto.
Una Connection es una instancia configurada de ese tipo, con nombre,
configuración pública, referencias de secretos, estado, datos sincronizados y
actividad propios.

## Crear y operar una conexión

1. Abre Connectors y elige un tipo de conector registrado del catálogo.
2. Crea o selecciona su conexión, ingresa la configuración solicitada y guarda.
3. Usa Test para verificar credenciales y alcance del proveedor.
4. Usa Sync para obtener datos actuales del proveedor e inspecciona estado o logs.

El formulario de configuración se genera desde el schema del conector cuando es
posible. Los campos secretos los maneja el Secret Store configurado y nunca se
devuelven en respuestas ordinarias de configuración.

## Tipos e instancias de conector

El catálogo actualmente clasifica tipos por nivel y ciclo de vida.

| Campo | Significado |
|---|---|
| Community | Una integración comunitaria de propósito general. Viene con Lintaya. |
| Enterprise | Una integración pensada para sistemas empresariales o internos. Se instala aparte. |
| Development | Una integración aún en desarrollo activo. Se instala aparte. |
| Stable, beta, development, deprecated | Señal de ciclo de vida para expectativas de compatibilidad. |
| Instantiable | El tipo permite conexiones configuradas adicionales. |

GitLab, GitHub, Bitbucket, Outline, Portainer, Qportal, Outlook, Outlook
Local y Plane son instantiable. vCenter, Bitwarden, Anthropic y UCS Manager
son tipos de instancia única intencionalmente por ahora.

Lintaya entrega el nivel community: la lista completa está en [Conectores
Community](community/introduccion.es.md).

Los tipos enterprise y development se distribuyen en un paquete de conectores
aparte y se instalan en un directorio fuera de la aplicación. Sus páginas no
están aquí — vienen con los conectores, y aparecen bajo **Conectores
instalados** una vez instalado el paquete. Una instalación sin él simplemente no
los lista, y no falta ni se rompió nada.

Es a propósito. Una página que describa un conector que este repositorio no
entrega sería una copia: se quedaría vieja la primera vez que el conector
cambiara, y nadie leyéndola se enteraría.

## Qué declara un manifiesto

Todo tipo tiene un manifest.json propiedad de su paquete de conector. Los campos
de identidad requeridos son manifestVersion, id, displayName, version, tier,
lifecycle, license, capabilities e implementation.

El upstreamApi opcional describe el proveedor y su fecha supported-until. Los
blocks opcionales declaran feeds list que se pueden agregar a dashboards. Los
modules opcionales declaran una vista de navegación propiedad de conector usando
id, label, icon, component y navOrder opcional. Un config.schema.json cercano
describe campos de configuración, cuáles son requeridos y cuáles son secretos.

Un manifiesto describe metadata y capacidades declarativas seguras; nunca envía
código UI ejecutable al navegador.

## Contexto y seguridad

Cada Connection puede guardar contexto de IA: instrucciones Markdown mantenidas
por el usuario para agentes que trabajan mediante esa conexión. Es guía de
negocio, no un almacén de secretos ni una concesión de autorización.

Eliminar una Connection extra borra estado local y entrada de secretos propios de
esa conexión. No debe usarse para borrar registros remotos salvo que una acción
futura aprobada solicite explícitamente esa operación.
