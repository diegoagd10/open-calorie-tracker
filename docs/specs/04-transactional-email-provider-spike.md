# 04 — Spike de proveedor de email transaccional

## Objetivo

Eliminar el bloqueo externo de autenticación seleccionando, con evidencia reproducible, el proveedor y la arquitectura de entrega de magic links. El resultado debe ser una decisión implementable por la spec 05, no una integración de producción incompleta.

## Contexto y dependencias

- Fuente de verdad: PRD.md, sección 3 y la historia OCT-001.
- Requiere specs 01–03: API Hono ejecutable, Vitest y persistencia SQLite para links e intentos.
- El PRD exige email verification, passwordless sign-in, error claro, resend y sesiones persistentes. No designa proveedor.
- Un spike produce evidencia, ADR y contratos; no habilita login al usuario.

## Alcance

### Dentro

- Comparar al menos tres proveedores viables de email transaccional.
- Probar una entrega sandbox de magic link con el candidato principal.
- Definir EmailSender, errores, observabilidad, límites y configuración.
- Documentar privacidad, costo, regiones, SLA, rate limits y lock-in.
- Decisión explícita con alternativa de respaldo.

### Fuera

- UI/login completo, cuentas, cookies o sesiones; spec 05.
- Contratar un plan pagado o publicar secretos sin autorización.
- Marketing email, templates no relacionados y recuperación de cuenta.

## Tareas en orden

1. Derivar criterios ponderados: deliverability, dominio propio, sandbox, API/SDK Node, webhooks, rate limits, precio proyectado, regiones, DPA, retención, observabilidad y facilidad de reemplazo.
2. Investigar únicamente documentación primaria y términos vigentes de al menos tres candidatos; registrar fecha y enlaces en docs/decisions/004-email-provider.md.
3. Definir el volumen supuesto y comparar costo normal y picos/abuso; marcar supuestos que requieren confirmación del owner.
4. Crear el contrato EmailSender.sendMagicLink con timeout, idempotency key, respuesta sent/failed y códigos internos que nunca lleguen crudos a UI.
5. Implementar un probe desechable contra sandbox del candidato principal, detrás del contrato y excluido de la suite obligatoria. No versionar secretos ni destinatarios reales.
6. Verificar dominio/remitente, enlace HTTPS, expiración, encoding, latencia, error 4xx/5xx, timeout y retry documentado.
7. Definir webhooks estrictamente necesarios, autenticación de webhook, deduplicación y retención mínima; no almacenar cuerpo del email.
8. Redactar ADR con decisión, ranking, evidencia, riesgos, fallback, variables de entorno y condición para reabrir la decisión.
9. Añadir contract tests locales con fake para que la spec 05 pueda implementarse sin red.

## Criterios de aceptación verificables

- El ADR compara al menos tres proveedores contra los mismos criterios y recomienda uno sin dejar empate ambiguo.
- Existe evidencia fechada de un envío sandbox o un bloqueo reproducible con owner y siguiente acción.
- El contrato distingue éxito, error retryable y terminal sin filtrar detalles sensibles.
- Costos, límites, región/privacidad, dominio y requisitos de producción están documentados con fuentes primarias.
- La spec 05 puede nombrar el adapter elegido, variables y contract tests sin investigar de nuevo.
- pnpm test sigue pasando sin red ni credenciales.

## Notas técnicas

- El probe no es código de producto; conservar solo lo necesario para contract tests.
- Normalizar proveedores detrás de un puerto pequeño y mantener el template en código versionado.
- No registrar tokens o magic links completos. Redactar query strings en logs.
- Si ninguna opción satisface privacidad o deliverability, el resultado válido es “bloqueado” con evidencia y owner, no una elección arbitraria.
