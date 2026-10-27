# SpookyThon 2026 · Track B — Estrategia técnica

> Objetivo: una herramienta que, con la semilla que elija el jurado y con cualquier Brote Sorpresa, demuestre con números que la estrategia del comité le gana a "no hacer nada" y a "azar con los mismos recursos".
> Lo que haría fallar el plan: una estrategia que solo gana con ciertos parámetros, controles que no existen en la interfaz o un despliegue AWS que no está listo a tiempo.

---

## 1. Decisiones en una tabla

| Tema | Decisión | Por qué |
|---|---|---|
| Modelo | **SEIR estocástico basado en agentes sobre una red multicapa**, en pasos de 1 día | Cumple el Nivel Base, permite cerrar lugares (se apaga una capa) y se explica en 1 minuto |
| Población | **Manta sintética de 20 000 agentes** (escala reducida, documentada) en hogares, colegios, trabajos, buses, mercados y barrios | La organización no da datos; con 20k se corren miles de simulaciones baratas |
| Plaga | Transmisión **persona a persona** inspirada en influenza/COVID (no en dengue) | El dengue se transmite por mosquito y necesita otro modelo. Persona a persona encaja directo con la red |
| Parámetro de contagio | Se fija un **R0 objetivo** y β se calibra por simulación | "R0 = 2.5" se justifica con literatura; un β suelto no |
| Intervención Base | **K vacunas** que llegan **por día** (ej. 200/día) | Nivel Base + "recursos que llegan por días" (Pro) |
| Intervenciones Pro | + **cierre de lugares** (mercado, colegios) y **cuarentena de hogar** con costo, dentro de un **presupuesto** | Varias intervenciones con presupuesto (Pro) |
| Estrategia | **Torneo automático**: se corren varias estrategias candidatas y se recomienda la que más salva | Ante el Brote Sorpresa no hay que pensar en vivo: se aprieta "Recomendar" |
| Comparación | **Números aleatorios comunes**: cada semilla se usa con las 3 políticas | Comparación pareada: misma epidemia, solo cambia la política. Menos ruido y más justo |
| Stack | **Python 3.12 + NumPy/SciPy** (motor) · **Vite + TypeScript + Chart.js + Leaflet** (web) · **AWS SAM** (infraestructura) | Motor vectorizado y rápido; front estático barato; SAM cabe en un repo |
| Región | **us-east-1** | Precios más bajos y todos los servicios (Bedrock incluido). Se documenta en el README |

---

## 2. El modelo

### 2.1 Estados y transiciones (cada día)

```
S (Sano) --contagio--> E (Mordido) --incubación--> I (Zombie) --recupera/muere--> R (Exorcizado)
S --vacuna (eficacia ε)--> V (vacunado, cuenta como protegido)
```

- **Contagio:** para cada Sano, la probabilidad de infectarse en el día es
  `p = 1 − Π (1 − β · w_capa)` sobre sus vecinos Zombie en capas abiertas.
  Se calcula para todos a la vez con una multiplicación de matriz dispersa (CSR), así que cada día cuesta milisegundos.
- **Incubación y fase contagiosa:** duraciones con distribución gamma, no fijas: media ~4 días de incubación y ~6 días contagioso (rango tipo influenza/COVID). Valores finales con fuente en el README.
- **Vacuna:** solo se aplica a quien está **Sano y no vacunado**. Eficacia `ε` configurable (default 0.9). Con `ε = 0.5` está cubierto el Brote Sorpresa de "variante que la vacuna cubre a medias".
- **Matiz que suma puntos de rigor:** el comité **no ve** a los Mordidos, que todavía no tienen síntomas. La estrategia solo puede excluir a quien sabe que es Zombie o Exorcizado. Una dosis puesta a un Mordido se pierde, igual que pasaría en la realidad. Lo medimos y lo reportamos como "dosis desperdiciadas" (debería ser bajo).

### 2.2 Población sintética de Manta

| Capa | Cómo se arma | Peso de contacto `w` |
|---|---|---|
| Hogar | Hogares de ~3–4 personas (tamaño medio del INEC; verificar valor del Censo 2022) | 1.0 (alto) |
| Colegio | Niños/jóvenes 5–17 agrupados en aulas de ~30 | 0.5 |
| Trabajo | Adultos en grupos de ~10 | 0.3 |
| Bus | Contactos aleatorios cortos entre adultos/estudiantes por línea | 0.1 |
| Mercado | Pocos "hubs" (ej. mercado central) con muchos contactos débiles | 0.05 |
| Barrio | Hogares repartidos en ~10 barrios; contacto aleatorio débil dentro del barrio | 0.02 |

- Los **barrios** llevan coordenadas aproximadas de Manta, y así se puede hacer el mapa animado en Leaflet.
- Edades por grupo según pirámide del INEC (verificar). La escala es 20k agentes que representan la ciudad; el factor de escala va en el README.
- **La red se genera a partir de la semilla**: misma semilla, misma ciudad.
- Pesos `w`: son **supuestos**, se declaran como tales y se justifican con estudios de matrices de contacto por entorno (tipo POLYMOD). El R0 calibrado absorbe la escala absoluta.

### 2.3 Calibración de β

1. Se fija R0 objetivo (default 2.5; el usuario lo cambia en la UI).
2. Se mide R0 empírico: se siembra 1 caso en una población totalmente susceptible y se cuentan los contagios que produce, promediado en ~200 corridas.
3. Se ajusta β por bisección hasta que coincida. La tabla β↔R0 se calcula una vez por red y se guarda.

"El doble de contagiosa" = R0 × 2, que se calibra a un β nuevo. Es más honesto que duplicar β a ciegas.

### 2.4 Salidas de cada corrida

Curva diaria S/E/I/R/V, total de infectados (tasa de ataque), pico y día del pico, dosis usadas y desperdiciadas, y estado final por barrio (para el mapa).

---

## 3. La estrategia (lo que se defiende ante el jurado)

### 3.1 Estrategias candidatas

| Estrategia | Idea en una frase para el alcalde | Información que necesita |
|---|---|---|
| **Grado** | "Vacunar primero a quien tiene más contactos" | La red completa |
| **Conocido** (acquaintance) | "Elegir gente al azar y vacunar a **un contacto** suyo" | Casi nada; funciona en la vida real |
| **Anillo** | "Vacunar alrededor de cada caso detectado" | Casos visibles |
| **Anillo + hubs** | "Anillo cerca de los brotes; el resto de dosis a los más conectados" | Casos visibles + red |
| **Cierre dirigido** (Pro) | "Cerrar el mercado/colegio cuando los casos pasen de X" | Conteo de casos por lugar |

- **Líneas base obligatorias:** *Nada* y *Azar*. Azar = mismas dosis por día, elegidas al azar **entre los mismos elegibles** (Sanos no vacunados y no detectados). Si no, la comparación sería injusta.
- **Adaptativa:** las dosis llegan por día y cada día se re-decide con el estado visible del brote. Cumple "decisiones que cambian según el brote" (Pro).

### 3.2 El "Torneo" (el arma para el Brote Sorpresa)

Botón **Recomendar**: con la configuración actual corre cada candidata en N semillas (las mismas para todas) y muestra:

- Personas salvadas vs *Nada* y vs *Azar*: **promedio e intervalo del 90 %**.
- **% de semillas en que gana** a cada línea base (ej. "gana en 97 de 100").
- Recomendación en lenguaje simple: *"Con estas condiciones, vacunen primero a los contactos de los casos en Tarqui y Los Esteros; se evitan ~1 800 contagios (entre 1 500 y 2 100)."*

Así, en el Brote Sorpresa el equipo cambia el parámetro, aprieta Recomendar y en menos de un minuto tiene la nueva recomendación con números. No hay que improvisar.

### 3.3 Por qué es riguroso

- **Pareado:** la misma semilla para *Nada*, *Azar* y la *Estrategia*. La diferencia se calcula por semilla y luego se promedia. Es el mismo diseño que un ensayo pareado.
- **Muchas corridas:** 200 en la UI interactiva y 2 000+ en el modo Monte Carlo en AWS.
- **Rangos siempre**, nunca un solo número.
- **Pruebas de estrés previas:** antes del pitch se corre una matriz con R0 ×2, vacunas ½, inicio en mercado y eficacia 0.5, y se guarda la tabla de resultados en `docs/`. Si una estrategia falla en algún escenario, el torneo ya elige otra; eso se muestra como robustez.

---

## 4. Arquitectura AWS

```
Usuario ──► CloudFront ──► S3 (web estática: Vite build)
   │
   └──► API Gateway (HTTP API, con throttling)
            ├── POST /simulate   ──► Lambda "simulate"   (≤200 corridas, responde en <30 s)
            ├── POST /recommend  ──► Lambda "simulate"   (torneo rápido)
            ├── POST /jobs       ──► Step Functions ──► Distributed Map ──► Lambda "worker" × N
            │                                                    │
            │                                                    ▼
            │                                         S3 (resultados por lote)
            │                                                    │
            │                                         Lambda "aggregate" ──► S3 resumen.json
            └── GET  /jobs/{id}  ──► Lambda "status" (lee el estado de la ejecución + resumen en S3)
   (opcional Pro) Lambda "report" ──► Bedrock (informe para el alcalde)
CloudWatch: logs y métricas · AWS Budgets: alerta de gasto
```

| Pieza | Servicio | Detalle |
|---|---|---|
| Web | S3 + CloudFront | Bucket privado con OAC; solo CloudFront es público |
| API | API Gateway HTTP API | Límite de 30 s por petición: el modo interactivo se mantiene por debajo |
| Simulación interactiva | Lambda (Python, 2–3 GB de memoria) | Más memoria = más CPU = respuesta más rápida |
| Monte Carlo masivo | Step Functions Distributed Map | Reparte, por ejemplo, 2 000 corridas en 100 lotes de 20 en paralelo |
| Resultados | S3 | JSON por lote + resumen. Sin base de datos: menos piezas que explicar |
| Informe alcalde (Pro) | Bedrock **o** plantilla de texto | Empezar con plantilla (gratis y determinista); Bedrock solo si sobra tiempo |
| Infraestructura | AWS SAM (`infra/template.yaml`) | Todo como código, se despliega con un comando |

**Seguridad (es el 25 % de calidad técnica):**
- Cero llaves en el código. Despliegue con perfil local (`aws configure sso` o un usuario IAM solo para desplegar), nunca credenciales en el repo.
- Cada Lambda con su propio rol mínimo (políticas de SAM limitadas a *su* bucket o *su* máquina de estados).
- API pública con **throttling** y **tope de parámetros** (máx. corridas, máx. agentes, máx. días). Si la URL pública cae en manos de cualquiera, no puede disparar el gasto.
- Bucket S3 bloqueado al público.

**A verificar antes de construir:** la cuota de concurrencia de Lambda en Service Quotas. En cuentas nuevas puede ser baja y limitar el paralelismo del Distributed Map. Si es baja, se pide aumento el primer día o se baja `MaxConcurrency`.

---

## 5. Costos (orden de magnitud, a confirmar en calculator.aws)

| Concepto | Supuesto | Costo estimado |
|---|---|---|
| Lambda | 1 trabajo Monte Carlo = 100 lotes × 2 GB × ~15 s ≈ 3 000 GB-s | Céntimos por trabajo; el free tier mensual de Lambda cubre cientos |
| Step Functions | 1 trabajo ≈ cientos de transiciones de estado | Céntimos |
| S3 + CloudFront | Web de pocos MB y JSON pequeños | ~USD 0–1/mes |
| API Gateway HTTP API | Miles de peticiones | Céntimos |
| Bedrock (opcional) | Pocos informes | Céntimos |
| **Total esperado del evento** | | **Por debajo de USD 5**; Budget con alerta en USD 10 |

`docs/costos.md` debe tener el cálculo con los precios oficiales del día y el gasto **real** tomado de Cost Explorer al final. Así se cumple "declaración coherente con la cuenta".

---

## 6. Estructura del repositorio

```
README.md
docs/
  arquitectura.drawio  arquitectura.png
  costos.md  budget.png
  supuestos.md          # tabla de cada parámetro: valor, fuente o "supuesto porque…"
  estres.md             # resultados de la matriz de Brote Sorpresa
src/
  engine/               # Python puro, sin AWS: se prueba en local
    population.py       # genera la Manta sintética desde la semilla
    seir.py             # paso diario vectorizado
    strategies.py       # nada, azar, grado, conocido, anillo, anillo+hubs, cierres
    montecarlo.py       # corridas pareadas + estadísticas
    calibrate.py        # β ↔ R0
  handlers/             # adaptadores Lambda delgados (simulate, worker, aggregate, status)
  web/                  # Vite + TS + Chart.js + Leaflet
tests/                  # pytest
infra/template.yaml     # AWS SAM
```

Arquitectura hexagonal ligera: el **motor no conoce AWS**. Los handlers solo traducen HTTP/eventos a llamadas del motor. Se prueba todo en local y se explica fácil ante el jurado.

---

## 7. Pruebas que demuestran que funciona

| Prueba | Qué garantiza |
|---|---|
| Misma config + semilla ⇒ resultados idénticos byte a byte | Reproducibilidad (requisito 6) |
| S+E+I+R+V = N todos los días | Que no se "pierde" ni se "crea" gente |
| Nunca se vacuna a alguien Zombie, Exorcizado o ya vacunado | La trampa que el jurado busca |
| Azar y Estrategia usan exactamente las mismas dosis por día | Comparación justa |
| R0 = 0 ⇒ nadie más se contagia; vacunar a todos ⇒ no hay brote | Sanidad del modelo |
| R0 calibrado ≈ objetivo (±10 %) | Calibración correcta |
| Matriz de estrés: la recomendada gana a *Azar* en ≥ 90 % de semillas | Robustez ante el Brote Sorpresa |

Semilla: `numpy.random.SeedSequence(semilla).spawn(n)`, un generador por corrida. Los resultados no cambian por el orden ni por correr en paralelo en Lambda.

---

## 8. Plan hasta el miércoles 10:00

Hoy es lunes 26 por la noche. Quedan ~36 horas reales. El plan deja la entrega lista a las **09:00 del miércoles**, con una hora de margen.

| Bloque | Cuándo | Entregable que queda hecho | Si se atrasa, se recorta… |
|---|---|---|---|
| **0. Arranque** | Lun 21:30–22:30 | Cuenta AWS + **Budget con alerta + captura** (es obligatorio desde el día 1). Repo público creado, primer commit | Nada; es obligatorio |
| **1. Motor** | Lun 22:30–02:00 | `population.py`, `seir.py`, calibración y pruebas de reproducibilidad y conservación en verde | Bajar a 3 capas (hogar, colegio, barrio) |
| **2. Estrategias** | Mar 08:00–12:00 | Nada, Azar, Grado, Conocido, Anillo y Montecarlo pareado. Primera tabla de resultados | Quitar Anillo+hubs |
| **3. AWS mínimo** | Mar 12:00–15:00 | SAM: Lambda `simulate` + HTTP API + S3/CloudFront con una página de prueba. **URL pública viva** | — (es un DEBE) |
| **4. Interfaz** | Mar 15:00–20:00 | Controles (R0, vacunas/día, punto de inicio, eficacia, semilla, presets de Brote Sorpresa), 3 curvas, tabla con rangos, botón **Recomendar** | Mapa queda para el bloque 5 |
| **5. Pro** | Mar 20:00–00:30 | Distributed Map (Monte Carlo masivo), cierres con presupuesto, mapa animado por barrio, informe para el alcalde con plantilla | Hacer solo lo que entre, en este orden |
| **6. Estrés** | Mar 00:30–01:30 | Matriz de Brote Sorpresa corrida y guardada en `docs/estres.md`; defaults finales fijados | — |
| **7. Documentos** | Mié 06:30–09:00 | README (supuestos, defaults + semilla, deploy, pruebas, limitaciones), diagrama, `costos.md` con gasto real, PDF del pitch | Video opcional: se salta |
| **8. Entrega** | Mié 09:00–09:30 | Verificar URL, repo, README y PDF; subir en la plataforma | — |

**Reglas para no hundirse:**
- Commits pequeños y frecuentes, uno por pieza que funciona. El historial real es un entregable.
- **El bloque 3 va antes de la interfaz completa:** desplegar temprano evita la sorpresa de AWS a las 3 de la mañana.
- Si en algún bloque el atraso pasa de 1 hora, se aplica la columna "se recorta" sin discutir.
- Si son varios en el equipo, se reparte así: **A** motor + estrategias, **B** infraestructura AWS + API, **C** interfaz + documentos. El contrato entre ellos es el JSON de entrada/salida de `/simulate`, que se fija en el bloque 1.

---

## 9. Contrato de la API (para que front y back trabajen en paralelo)

```json
// POST /simulate
{
  "seed": 42, "runs": 200, "days": 120, "population": 20000,
  "r0": 2.5, "vaccine_efficacy": 0.9,
  "doses_per_day": 200, "start_day_vaccines": 3,
  "seed_location": "market",   // "random" | "market" | "school" | barrio_id
  "initial_cases": 5,
  "strategy": "auto"           // "auto" = torneo; o "degree" | "acquaintance" | "ring" | ...
}
// Respuesta
{
  "policies": {
    "none":     { "attack_rate": {"mean":0.62,"p5":0.58,"p95":0.66}, "curve_mean": [...] },
    "random":   { ... },
    "strategy": { "name": "ring_hubs", ... }
  },
  "saved_vs_none":   {"mean": 4100, "p5": 3600, "p95": 4550},
  "saved_vs_random": {"mean": 1800, "p5": 1500, "p95": 2100},
  "win_rate_vs_random": 0.97,
  "wasted_doses": {"mean": 0.04},
  "recommendation_text": "..."
}
```

Los números del ejemplo son ilustrativos, no resultados.
