# Declaración de costos

Región: **us-east-1 (N. Virginia)**. Precios públicos de AWS para x86 (a confirmar en [calculator.aws](https://calculator.aws) el día del despliegue; aquí se deja el cálculo visible).

| Servicio | Precio usado | Capa gratuita mensual |
|---|---|---|
| Lambda | USD 0,0000166667 por GB-s · USD 0,20 por millón de invocaciones | 400 000 GB-s y 1 millón de invocaciones |
| Step Functions (Standard) | USD 0,025 por 1 000 transiciones de estado | 4 000 transiciones |
| API Gateway HTTP API | USD 1,00 por millón de peticiones | — (12 meses: 1 millón) |
| CloudFront | USD 0,085 por GB hacia Internet | 1 TB y 10 millones de peticiones (siempre gratis) |
| S3 Standard | USD 0,023 por GB-mes | 5 GB (12 meses) |

## Cuánto cuesta una operación

**Un "Recomendar" interactivo** (6 políticas × 100 corridas, cortadas en 24 trozos de 25 corridas):

```
workers:  24 invocaciones × ~2 s × 3,008 GB  ≈ 144 GB-s
API:       1 invocación  × ~8 s × 1,769 GB  ≈  14 GB-s
total ≈ 158 GB-s × 0,0000166667 ≈ USD 0,0026  (+ 25 invocaciones ≈ USD 0,000005)
```

**Un trabajo de Modo Jurado** (49 brotes × 9 trozos de 12 corridas, Distributed Map):

```
Lambda:  441 invocaciones × ~1,5 s × 3,008 GB ≈ 1 990 GB-s ≈ USD 0,033
Step Functions: ~441 × 2 + 10 ≈ 900 transiciones ≈ USD 0,023
total ≈ USD 0,06
```

**Mapa de decisión** (72 condiciones × 6 políticas × 20 corridas = 432 trozos): ≈ 432 × 3 s × 3,008 GB ≈ 3 900 GB-s ≈ USD 0,065 + 870 transiciones ≈ USD 0,022. Total ≈ **USD 0,09**.

## Costo mensual estimado

Escenario de uso del evento: 500 "Recomendar" + 10 trabajos de Modo Jurado + 5 mapas de decisión + 2 GB servidos.

| Concepto | Cálculo | Sin capa gratuita | Con capa gratuita |
|---|---|---|---|
| Lambda | 500 × 158 + 10 × 1 990 + 5 × 3 900 ≈ 118 400 GB-s | USD 1,97 | USD 0 (< 400 000 GB-s) |
| Step Functions | 15 trabajos × ~900 transiciones = 13 500 | USD 0,34 | USD 0,24 |
| HTTP API | ~2 000 peticiones | USD 0,002 | USD 0 |
| CloudFront | 2 GB | USD 0,17 | USD 0 |
| S3 | < 0,1 GB | < USD 0,01 | USD 0 |
| **Total** | | **≈ USD 2,5 / mes** | **≈ USD 0,25 / mes** |

Protecciones contra un gasto inesperado:
- HTTP API con **throttling** (5 peticiones/s, ráfaga de 10).
- Límites en el motor: máximo 200 corridas por petición pública, 40 000 agentes y 365 días (`SimConfig.validated`).
- Fan-out acotado (`MaxFanout` = 10) y `MaxConcurrency` del Distributed Map = 40.
- Resultados en S3 con expiración a los 30 días.
- **AWS Budget con alerta** (captura en `docs/budget.png`, pendiente de que el equipo cree la cuenta).

## Gasto real del evento

> Pendiente: se completa con Cost Explorer al final del evento (servicio por servicio y total), junto con la captura del Budget.

| Fecha | Fuente | Gasto |
|---|---|---|
| — | Cost Explorer | pendiente |
