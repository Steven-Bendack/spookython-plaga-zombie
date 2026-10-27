# Decisiones de diseño

La base es `docs/referencia/estrategia-tecnica.md`. Aquí van las decisiones que la cambian o la precisan, con el motivo y la evidencia.

## Lo que diferencia al proyecto

1. **La estrategia es el torneo, no una regla.** El Modo Jurado (red team automático) probó 49 brotes sorpresa. La mejor regla fija del escenario base, «Anillo + conectados», **pierde contra Azar en el 76 % de ellos** (siempre que R0 ≥ 2,3: sus dosis van a contactos que ya fueron mordidos y no se ven). El **torneo automático**, que elige la estrategia con semillas de entrenamiento y se juzga con semillas nuevas, **no perdió en ninguno**. Por eso recomendamos el comité automático y mostramos la regla fija como contraejemplo. Esto convierte la mayor amenaza de la Prueba de fuego (el Brote Sorpresa) en evidencia a nuestro favor. Cifras exactas: `src/web/data/jury.json` y la sección Modo Jurado de la interfaz.
2. **Números aleatorios comunes.** La corrida *k* usa los mismos números aleatorios en todas las políticas: quién se contagia cada día (sorteo por agente), duraciones, detección, si la dosis funciona y dónde empieza. Cada propósito tiene su propio generador `SeedSequence(semilla, spawn_key=(corrida, propósito))`, así que añadir una política o repartir las corridas en procesos o Lambdas **no cambia** los resultados (hay un test que lo verifica).
3. **Mapa de decisión precalculado** (72 condiciones: R0 × dosis × eficacia × lugar de inicio). Responde al instante en el Brote Sorpresa y luego se confirma en vivo con la semilla del jurado.
4. **Realismo de información.** Las estrategias solo ven los Zombies detectados (60 %, con 2 días de retraso). Las dosis que caen en Mordidos o Zombies invisibles se reportan como "dosis perdidas" en la interfaz.
5. **Calibración con datos reales de Manta.** Con el exceso de muertes de 2020 (Registro Civil) medimos que la primera ola crecía 8,4 % por día y buscamos el R0 que reproduce ese crecimiento en nuestra Manta: **2,35**. La curva del modelo cae encima de las barras reales (sección "Evidencia real y ficción" de la interfaz).
6. **Contraste con la ficción** (lo pidió el jurado): el mismo motor corre el zombi clásico (parámetros de Alemi et al. 2015), The Walking Dead y Guerra Mundial Z. Cada escenario pide una estrategia distinta: con zombis lentos gana el **anillo** (100 % de las semillas); con COVID en Manta, **los más conectados**; con Guerra Mundial Z cae el 94 % de la ciudad y ninguna vacunación cambia el resultado. Eso refuerza la tesis: la respuesta correcta es un comité que elige, no una regla fija.
7. **Mapa animado de Manta.** Repite la corrida 1 día por día sobre el mapa real (vuelo de Ecuador a Manta, puntos que se encienden, contadores y titulares generados con lo que pasó en esa corrida). Es un lenguaje visual habitual en los juegos de pandemias, hecho por nosotros: no copiamos código ni recursos de ningún juego.
8. **Certificado de reproducibilidad.** Hash de la configuración + semilla + semilla de ciudad + versión del motor + commit, y un enlace que codifica toda la configuración en la URL.

## Cambios frente a la estrategia técnica original

| Tema | Plan original | Decisión | Por qué |
|---|---|---|---|
| Agentes | 20 000 | **10 000** | Medido: 100 corridas × 6 políticas con 20 000 agentes tardaban 26 s en 12 núcleos, y con 10 000, 12 s. En el Brote Sorpresa hay 5 minutos. La estructura (hogares, aulas, trabajos, mercado) no cambia; cada agente pasa a representar 27 personas |
| Elección de la mejor estrategia | menor promedio de contagiados | **mediana** de salvados frente a Azar (el promedio desempata) | En el mapa de decisión, una estrategia con mejor promedio ganaba a Azar solo en el 5 % de las semillas: una corrida de suerte movía el promedio. El jurado verifica con *su* semilla, así que importa la corrida típica |
| Semilla y ciudad | la red se genera con la semilla | **dos semillas:** `city_seed` (la ciudad, fija por defecto en 2026) y `seed` (la del jurado: las epidemias) | Así β se calibra una sola vez por ciudad y la semilla del jurado cambia la epidemia, no el mapa de la ciudad. Ambas van en el certificado |
| SciPy | matrices dispersas de SciPy | **CSR propio con NumPy** (`indptr`, `indices`, `weight`) | Una sola dependencia: la capa de Lambda es más chica y se construye sin Docker. La suma dispersa toca solo las aristas de los Zombies del día |
| Sorteo del contagio | comparar un uniforme con p = 1 − Π(1 − β·w) | **exponencial**: se contagia si X < h, con X ~ Exp(1) y h = −Σ log(1 − β·w) | Es exactamente la misma probabilidad (P(X < h) = 1 − e^(−h)) y ahorra una exponencial por agente y día |
| Fin de la campaña | vacunar todos los días | la campaña de cada corrida se detiene cuando su brote se extingue | Sin brote no tiene sentido vacunar, y así el resultado no depende de cómo se reparten las corridas |
| Interfaz | Vite + TypeScript + Leaflet | **HTML + JS sin compilar + Chart.js** | Sin paso de build: `src/web` se sube tal cual a S3. Menos piezas que explicar. El mapa animado queda como trabajo futuro |
| Interactivo en AWS | una Lambda | **Lambda API + fan-out a Lambdas worker** (hasta 10 en paralelo) | Una sola Lambda tardaría más que el límite de 30 s del API Gateway. El trabajo se corta en trozos (una política, un rango de corridas), igual que en local con procesos |
| Monte Carlo masivo | Step Functions Distributed Map | igual, con el **mismo worker** | El worker es la misma función pura (`run_chunk`) que usa el servidor local |
| Mapa | Leaflet (opcional) | **Leaflet + mosaicos de Esri** (oscuro y satélite) y una capa canvas para miles de personas | Google Maps y CARTO exigen llave de API; Esri es gratis con atribución. El canvas dibuja 6 000 puntos por cuadro sin trabarse |
| Web y API | dominios separados | **un solo CloudFront**: `/` a S3 y `/api/*` al HTTP API | Sin CORS y con una única URL pública |

## Alternativas evaluadas y descartadas

- **Collective Influence (Morone y Makse 2015):** mejor en teoría para redes grandes, pero necesita toda la red y no se explica en un minuto.
- **Aprendizaje por refuerzo:** demasiado opaco para defender ante el jurado y sin tiempo para validarlo.
- **Modelo por barrios (compartimentos):** no permite comparar estrategias por persona ni contar dosis perdidas.

## Cómo explicar el modelo en un minuto

> Generamos una Manta de 10 000 personas con hogares, colegios, trabajos, buses, el mercado y barrios, con proporciones del censo de 2022. Cada día, cada Zombie puede morder a sus contactos con una probabilidad que depende del lugar donde se ven; calibramos esa probabilidad para que un caso contagie en promedio a R0 personas. Mordido, Zombie y Exorcizado duran unos días al azar. Cada día llegan K vacunas y el comité decide a quién ponérselas, viendo solo los casos detectados. Corremos 100 veces cada estrategia con los mismos números aleatorios y comparamos corrida por corrida.
