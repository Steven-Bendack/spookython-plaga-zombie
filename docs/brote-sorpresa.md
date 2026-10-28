# Brote Sorpresa: respuestas precalculadas

En la Prueba de fuego el jurado cambia las condiciones y el equipo tiene 5 minutos. Esta hoja tiene la respuesta de la herramienta a cada cambio que el reto menciona, calculada en la URL pública de AWS. En vivo se repite con un clic y se confirma con la semilla que elija el jurado.

**Cómo se calculó:** `POST /api/simulate` en https://darwqtaqrduba.cloudfront.net, commit `b734413`, semilla **2026**, 100 corridas por política, 10 000 agentes (1 agente ≈ 27 mantenses) y el resto de parámetros por defecto (R0 2,0; 20 dosis al día desde el día 7; eficacia 0,9; detección 60 % con 2 días de retraso). Cada fila trae su hash de configuración: con la misma semilla, el resultado es idéntico.

## 1. Los cuatro cambios del reto

| Cambio del jurado | Enlace para repetirlo | Estrategia elegida | Contagios evitados frente a no hacer nada (rango 90 %) | Frente al azar | Gana al azar en | Hash |
|---|---|---|---|---|---|---|
| Ninguno (base) | [abrir](https://darwqtaqrduba.cloudfront.net/?seed=2026) | Anillo + conectados | **3 920** (889 – 6 510) | +2 696 | 95 de 100 | `f35af9a04a48` |
| El doble de contagiosa (R0 4) | [abrir](https://darwqtaqrduba.cloudfront.net/?seed=2026&r0=4) | Conocido | 571 (476 – 667) | +45 | 92 de 100 | `d1d4f69e215b` |
| La mitad de las vacunas (10/día) | [abrir](https://darwqtaqrduba.cloudfront.net/?seed=2026&doses_per_day=10) | Más conectados | **1 364** (919 – 2 018) | +759 | 99 de 100 | `40c471aaf99a` |
| Empieza en el mercado | [abrir](https://darwqtaqrduba.cloudfront.net/?seed=2026&seed_location=market) | Anillo + conectados | **4 727** (1 369 – 6 519) | +3 435 | 99 de 100 | `7a089ebaabfc` |
| La vacuna cubre a medias (eficacia 0,5) | [abrir](https://darwqtaqrduba.cloudfront.net/?seed=2026&vaccine_efficacy=0.5) | Más conectados | **1 453** (1 022 – 2 093) | +781 | 99 de 100 | `7a87b8b6d45a` |
| Los cuatro a la vez | [abrir](https://darwqtaqrduba.cloudfront.net/?seed=2026&r0=4&doses_per_day=10&seed_location=market&vaccine_efficacy=0.5) | Conocido | 159 (116 – 195) | +10 | 66 de 100 | `15486343dcc8` |

Cifras en agentes de la simulación; multiplicadas por 27,1 dan personas de Manta (los 3 920 del escenario base son ≈ 106 000 mantenses).

**Lectura:** la estrategia cambia según el brote, y eso es lo que el torneo automático tiene que hacer. Con brote normal gana la vacunación en anillo alrededor de los casos detectados. Cuando hay menos dosis o la vacuna protege menos, conviene concentrarlas en los más conectados. Con una plaga muy contagiosa, lo mejor es «Conocido», que llega a los conectados sin necesitar la red completa.

## 2. La pregunta incómoda: las dosis «perdidas»

El jurado busca equipos que vacunan a quien ya está infectado o es inmune. Nuestra herramienta **nunca vacuna a un Zombie detectado ni a un Exorcizado conocido** (hay un test que lo verifica). Lo que sí ocurre es que parte de las dosis cae en personas mordidas que todavía no tienen síntomas, o que se curaron sin que nadie lo detectara. El comité no puede verlas, igual que en la vida real. Por eso las contamos y las mostramos, en vez de esconderlas.

| Escenario | Dosis perdidas: estrategia | Dosis perdidas: azar | Contagios evitados por dosis: estrategia | Por dosis: azar | Ventaja por dosis |
|---|---|---|---|---|---|
| Base | 32 % | 24 % | **1,79** | 0,47 | **3,8 ×** |
| Empieza en el mercado | 24 % | 23 % | **2,35** | 0,49 | **4,8 ×** |
| La mitad de las vacunas | 45 % | 26 % | **0,97** | 0,46 | **2,1 ×** |
| La vacuna cubre a medias | 36 % | 26 % | **0,52** | 0,26 | **2,0 ×** |
| El doble de contagiosa | 61 % | 51 % | 0,38 | 0,36 | 1,1 × |

**Respuesta para el jurado:** «Sí, nuestra estrategia pierde un poco más de dosis que el azar, porque va a buscar el brote donde está: a los contactos de los casos, y algunos ya fueron mordidos sin que se note. Pero cada dosis nuestra evita casi 4 veces más contagios que una dosis al azar. Ese costo es el precio de llegar primero.»

## 3. Cuando las vacunas no alcanzan: qué decirle al alcalde

Con la plaga al doble de contagiosa, 20 dosis al día casi no cambian nada: la plaga alcanza al 83 % de la ciudad contra el 89 % sin intervenir. La herramienta lo detecta y prueba cierres por su cuenta. El mejor plan, cerrar el mercado, solo evita 158 contagios más. La recomendación honesta es otra: **faltan recursos, y hay que actuar antes.** Este barrido muestra cuánto haría falta (semilla 2026, R0 4, porcentaje de la ciudad que termina contagiada):

| Dosis al día | Desde el día 3: azar | Desde el día 3: estrategia | Desde el día 7: azar | Desde el día 7: estrategia |
|---|---|---|---|---|
| 20 | 83 % | 82 % | 83 % | 83 % |
| 40 | 76 % | 73 % | 78 % | 77 % |
| 80 | 63 % | **47 %** | 67 % | **56 %** |
| 160 | 37 % | **4 %** | 45 % | **11 %** |

Sin intervenir: 89 % en todos los casos.

**Frase para el alcalde:** «Con una plaga el doble de contagiosa, 20 vacunas al día no alcanzan. Con 160 al día desde el tercer día, y repartidas con nuestra estrategia, la plaga llega solo al 4 % de Manta. Repartidas al azar, a más de un tercio. Cada día de retraso cuenta: empezar el día 7 en vez del 3 casi triplica los contagios.»

## 4. Guion de 5 minutos para el Brote Sorpresa

1. **(30 s)** Abrir el enlace de la tabla 1 que corresponde al cambio del jurado, o elegir el preset en **Condiciones**.
2. **(30 s)** Poner la semilla que dice el jurado y pulsar **Recomendar** (≈ 8 s en AWS).
3. **(1 min)** Leer el veredicto: estrategia elegida, contagios evitados con su rango, y en cuántas semillas gana al azar.
4. **(1 min)** Si el jurado pregunta por las dosis perdidas, responder con la tabla 2.
5. **(1 min)** Si las vacunas no alcanzan, mostrar el plan de cierres que propone la herramienta y decir cuántas dosis harían falta (tabla 3).
6. **(1 min)** Abrir **Jurado** (Modo Jurado) para mostrar que la estrategia se probó contra decenas de brotes sorpresa.
