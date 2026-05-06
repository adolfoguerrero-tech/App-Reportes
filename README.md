# Rentamaq Reportabilidad

Aplicación web (PWA) para registrar y consolidar reportes de horas de maquinaria
(arriendo de flota a Teck). Sin build: HTML + CSS + JS plano sobre Firebase.

## Estructura

```
App-Reportes/
├── index.html    Markup de las vistas (login, splash, app y modales)
├── styles.css    Estilos (tema claro/oscuro, grilla, modales, responsive)
├── app.js        Lógica de la app (Firebase, vistas, validaciones, export)
└── .gitignore
```

## Vistas

- **Dashboard** — KPIs del período + tabla de equipos con paginación.
- **Grilla** — calendario por equipo (turno Día / Noche), reports y ausencias.
- **Nuevo Report** — formulario con validaciones estrictas (choque de turnos,
  descuento de horas con observación obligatoria, foto requerida si "Firmado").
- **Consolidados** *(admin)* — totales por proveedor / equipo, export Excel
  por hoja-equipo y ZIP de fotos.
- **Lotes Firma** *(admin)* — control de lotes enviados a firma del mandante.
- **Equipos** *(admin)* — CRUD de flota y proveedores.
- **Diagnóstico** *(admin)* — folios duplicados, saltos de horómetro,
  borradores sin foto.

## Stack

- Firebase 10.7.1 (Auth, Firestore con `enablePersistence`, Storage) — SDK *compat*.
- XLSX 0.18.5 (export Excel).
- JSZip 3.10.1 (ZIP de fotos).
- Service Worker minimal con cache-fallback offline.
- Manifest PWA inline.

## Modelo de datos (Firestore)

| Colección      | Campos clave |
|----------------|--------------|
| `usuarios`     | doc id = email · `rol` (`admin` / `operador`) |
| `equipos`      | doc id = patente · `tipo`, `proveedor`, `horo`, `estado` |
| `reportes`     | `fecha`, `turno` (Día/Noche), `equipo`, `folio`, `operador`, `hi`, `hf`, `dif`, `hef`, `obs`, `estado` (Borrador/Firmado), `foto`, `foto2` |
| `ausencias`    | `equipo`, `fecha`, `turno`, `motivo`, `descripcion`, `descuento`, `validado` |
| `proveedores`  | `nombre` |
| `lotes`        | `numero`, `fecha_despacho`, `entregado_a`, `estado`, `devueltos`, `obs` |

Storage: `fotos/{patente}/{reportId}_{1|2}.jpg`.

## Roles

El rol se decide consultando `usuarios/{email}.rol`. Los botones de
Consolidados / Lotes / Equipos / Diagnóstico se ocultan a operadores y la
función `show()` bloquea el cambio de vista. **La seguridad real depende de
las reglas de Firestore/Storage** (no incluidas en este repo).

## Período de operación

`defaultPeriod()` define el ciclo del 21 al 20 del mes siguiente (mes EDP).

## Optimizaciones de costo / red

- `db.enablePersistence()` para modo offline.
- Listeners filtrados a últimos 60 días (`reportes`, `ausencias`).
- Compresión de fotos en cliente a 1400 px / JPEG 75 % antes de subir.
- Paginación del dashboard (20 / 50 / 100).

## Helpers en `app.js`

- `$(id)` → atajo de `document.getElementById`.
- `esc(s)` → escape de HTML, aplicado a campos de usuario antes de
  interpolar en `innerHTML`.
- `getDif(r)` / `getHef(r)` → cálculo único de diferencia de horómetro y
  horas efectivas.

## Despliegue

Cualquier hosting estático sirve (Firebase Hosting recomendado por la
integración con el proyecto). Subir los tres archivos a la raíz.

## Pendientes / mejoras sugeridas

- Versionar `firestore.rules` y `storage.rules` en el repo.
- Migrar a Firebase modular v10 (dejar de depender de `*-compat`).
- Tests mínimos sobre `validate()`.
