# Supuestos y de dónde sale cada número

Regla del proyecto: **cada número tiene una fuente o dice "supuesto" y por qué.** Los valores por defecto viven en `src/engine/config.py` y `src/engine/population.py`.

## 1. La ciudad (Manta sintética)

| Parámetro | Valor | Fuente o justificación |
|---|---|---|
| Población real de Manta (cantón) | 271 145 | INEC, Censo de Población y Vivienda 2022 ([citypopulation.de, cantón Manta](https://www.citypopulation.de/en/ecuador/admin/manabí/1308__manta/); [Wikipedia, Manta Canton](https://en.wikipedia.org/wiki/Manta_Canton)) |
| Agentes simulados | 10 000 | **Supuesto de escala.** Cada agente representa 27,1 personas reales. Con esta escala, 6 políticas × 100 corridas se resuelven en segundos (ver `docs/decisiones.md`) |
| Edades 0-14 / 15-64 / 65+ en Manta | 66 266 / 183 270 / 21 609 (24,4 % / 67,6 % / 8,0 %) | INEC Censo 2022 vía [citypopulation.de](https://www.citypopulation.de/en/ecuador/admin/manabí/1308__manta/) |
| Grupos del modelo: 0-4 / 5-17 / 18-64 / 65+ | 8,15 % / 20,35 % / 63,53 % / 7,97 % | **Derivado** de la fila anterior, suponiendo edades repartidas de forma pareja dentro de cada tramo (0-4 = 5/15 de 0-14; 15-17 = 3/50 de 15-64) |
| Personas por hogar | 3,2 | INEC Censo 2022, promedio **nacional** ([INEC](https://www.ecuadorencifras.gob.ec/ecuador-crecio-en-2-5-millones-de-personas-entre-2010-y-2022/); [Expreso](https://www.expreso.ec/actualidad/censo-2022-hay-16-9-millones-ecuatorianos-familias-achican-173731.html)). No encontramos el valor de Manta, así que usamos el nacional. Cada hogar tiene un adulto o adulto mayor como jefe; el resto se reparte al azar (tamaño = 1 + Poisson(2,2)) |
| Barrios | 10 (Tarqui, Los Esteros, Centro, Eloy Alfaro, Jocay, La Pradera, Urbirríos, Barbasquillo, San Mateo, Santa Marianita) | **Supuesto.** Nombres reales de Manta; la proporción de hogares por barrio y las coordenadas son aproximadas. Hoy solo se usan para el punto de inicio y el contacto de barrio |
| Tamaño de aula | 30 | **Supuesto** (aula típica de colegio fiscal). Todos los estudiantes de 5 a 17 años van al colegio, agrupados por barrio |
| Adultos con trabajo fuera de casa | 55 % de 18-64 | **Supuesto.** Grupos de trabajo de 10 personas, mezclados entre barrios |
| Mercado central | 20 % de adultos y adultos mayores lo visitan; 1 % de los adultos son vendedores | **Supuesto.** Cada visitante tiene unos 6 contactos en el mercado; cada vendedor, 40 (son los "hubs") |
| Bus | 4 contactos promedio entre quienes van al colegio o al trabajo | **Supuesto** |
| Barrio | 4 contactos promedio dentro del barrio | **Supuesto** |

### Pesos de contacto por capa (intensidad diaria relativa a un contacto del hogar)

| Capa | Peso | Por qué |
|---|---|---|
| Hogar | 1,0 | Contacto largo y físico todos los días |
| Colegio | 0,2 | Contacto diario pero menos cercano que el hogar |
| Trabajo | 0,2 | Igual que el colegio |
| Bus | 0,05 | Contacto corto |
| Mercado | 0,05 | Contacto corto, muchas personas |
| Barrio | 0,02 | Contacto ocasional |

**Supuesto**, ordenado según el estudio POLYMOD: los contactos en casa y en el colegio son más largos y más físicos que los del trabajo o el transporte ([Mossong et al. 2008, PLoS Medicine](https://pmc.ncbi.nlm.nih.gov/articles/PMC2270306)). La **escala absoluta no importa**: el β calibrado la absorbe para que el R0 sea el elegido. Lo que importa es la proporción entre capas.

La red resultante (semilla de ciudad 2026, 10 000 agentes) tiene un promedio de 19,5 contactos distintos por persona.

## 2. La plaga

Plaga respiratoria inspirada en **influenza y COVID-19**, que se contagia de persona a persona. No elegimos el dengue porque lo transmite un mosquito y necesitaría otro modelo (vectores, agua, clima).

| Parámetro | Valor | Fuente o justificación |
|---|---|---|
| Estados | Sano (S), Mordido (E), Zombie (I), Exorcizado (R), Vacunado inmune (V) | SEIR sugerido en la misión |
| Días como Mordido (latencia) | media 3, gamma (forma 4) | **Supuesto intermedio** entre la incubación de la influenza A (mediana 1,4 días; Lessler et al. 2009, *Lancet Infectious Diseases*, revisión sistemática) y la de COVID-19 (mediana 5,1 días; [Lauer et al. 2020, Ann Intern Med](https://healthexec.com/topics/precision-medicine/coronavirus-incubation-period-51-days)). La latencia (no contagia) es algo más corta que la incubación (síntomas) |
| Días como Zombie (contagioso) | media 5, gamma (forma 4) | **Supuesto** dentro del rango de influenza y COVID. Con 3 + 5 días, el tiempo entre generaciones (≈ 5,5 días) queda por encima del intervalo serial de la influenza (media 3,6 días en [Cowling et al. 2009, Epidemiology](https://pmc.ncbi.nlm.nih.gov/articles/PMC3057478); 2,9 días para H1N1 2009 en [Donnelly et al. 2011, Clin Infect Dis](https://pmc.ncbi.nlm.nih.gov/articles/PMC3106264)) y más cerca del de COVID: una plaga algo más lenta que la gripe |
| Forma de las duraciones | gamma con forma 4 (coeficiente de variación 0,5), redondeada a días enteros, mínimo 1 día | **Supuesto:** las duraciones reales varían entre personas; una duración fija sería irreal |
| R0 por defecto | 2,0 | Entre la pandemia de influenza de 2009 (mediana 1,46; RIC 1,30-1,70) y la de 1918 (mediana 1,80; RIC 1,47-2,27), según la revisión de [Biggerstaff et al. 2014, BMC Infect Dis](https://www.biomedcentral.com/1471-2334/14/480), y algo por encima, como una plaga "más contagiosa que la gripe". "El doble de contagiosa" = R0 4,0 |
| ¿Mata o convierte? | Convierte y luego se "exorciza" (se recupera inmune) | Simplificación: no modelamos muertes |

### Cómo se calibra β a partir de R0

R0 = número promedio de personas que contagia **un caso índice elegido al azar** en una Manta totalmente susceptible. Para el caso índice *i*, con *D* días contagioso:

```
contagios esperados(i) = Σ sobre contactos j de  1 − Π_capas (1 − β·w)^D
```

Se promedia sobre todos los agentes y sobre la distribución de *D*, y se busca β por bisección. Los tests verifican que el valor coincide (±10 %) con el que sale de simular día a día con el propio motor (`tests/test_engine.py`).

## 3. La intervención: vacunas

| Parámetro | Valor | Fuente o justificación |
|---|---|---|
| Vacunas por día | 20 (0,2 % de la población al día, ≈ 542 dosis diarias en Manta) | **Supuesto** de escasez: no alcanza para todos y obliga a priorizar. "La mitad de las vacunas" = 10 |
| Llegan las vacunas el día | 7 | **Supuesto:** una semana para detectar el brote y recibir el primer lote |
| Eficacia | 90 % | **Supuesto** "todo o nada": la dosis inmuniza al 90 % de los Sanos que la reciben y no hace nada al resto. Protege desde ese mismo día (simplificación). "Variante que la vacuna cubre a medias" = 50 % |
| ¿A quién se puede vacunar? | Solo a quien **no** está vacunado y **no** fue detectado como Zombie | Así lo exige el jurado. El comité no ve a los Mordidos ni a los Zombies sin detectar: si vacuna a uno de ellos, la dosis se pierde y **se reporta** como "dosis perdidas" |
| Zombies detectados | 60 % | **Supuesto:** una parte de los casos es leve y nunca se detecta |
| Días hasta detectar | 2 | **Supuesto:** síntomas, consulta y prueba |
| La campaña se detiene | cuando el brote se extingue en esa corrida | Simplificación: no tiene sentido seguir vacunando sin brote |

## 4. Las estrategias y su respaldo

| Estrategia | Idea | Respaldo |
|---|---|---|
| Nada | Línea base obligatoria | Misión |
| Azar | Mismas dosis por día, al azar **entre los mismos elegibles** | Misión; si Azar pudiera vacunar a detectados, la comparación sería injusta |
| Más conectados | Primero quien tiene más contacto diario (suma de pesos) | Vacunación por grado/centralidad; estudios con datos incompletos muestran que suele ser la mejor estrategia global (["Immunization strategies in networks with missing data", PLoS Comput Biol 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7386582)) |
| Conocido | Elegir gente al azar y vacunar a un contacto suyo | Acquaintance immunization (Cohen, Havlin y ben-Avraham, 2003, *Physical Review Letters*): llega a los más conectados sin conocer la red. Lo implementamos como muestreo proporcional al número de contactos (Efraimidis-Spirakis), que es equivalente en promedio |
| Anillo | Vacunar a los contactos de cada caso detectado | Vacunación en anillo: erradicó la viruela y se probó contra el ébola en "Ebola ça suffit!" ([Henao-Restrepo et al. 2017, Lancet](https://www.gov.uk/research-for-development-outputs/the-ebola-ca-suffit-vaccine-trial-team-ring-vaccination-for-ebola)). En redes realistas supera al acquaintance ([PLoS ONE 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4008523/)) |
| Anillo + conectados | Anillo primero; el resto de dosis a los más conectados | Combinación propia |

Evaluamos y **descartamos** Collective Influence ([Morone y Makse 2015, Nature](https://hmakse.ccny.cuny.edu/wp-content/uploads/2015/07/nature14604.pdf)): es más potente en redes grandes, pero no se explica en un minuto y necesita conocer toda la red.

## 5. Monte Carlo y estadística

| Parámetro | Valor | Por qué |
|---|---|---|
| Corridas por política | 100 (interfaz), 12-20 por escenario (Modo Jurado y mapa) | Suficientes para que el IC 95 % del promedio sea estrecho frente a la diferencia entre estrategias |
| Días simulados | 150 | Con R0 = 2 el brote dura unos 130 días |
| Casos iniciales | 5 | **Supuesto** |
| Rango reportado | percentiles 5-95 de las corridas ("90 % de las corridas") e IC 95 % del promedio | Nunca un solo número |
| Comparación | **pareada**: la corrida *k* de cada política usa exactamente los mismos números aleatorios (quién se cruza con quién, duraciones, detección, si la dosis funciona) | Diseño de ensayo pareado: solo cambia la decisión, no la suerte |
| Cómo se elige la mejor | **mediana** de personas salvadas frente a Azar, corrida por corrida; el promedio desempata | El promedio puede ganarlo una sola corrida de suerte (lo encontramos en el mapa de decisión: una estrategia con mejor promedio ganaba solo en el 5 % de las semillas) |
| Empate en el Modo Jurado | diferencia promedio menor al 0,2 % de la población | Por debajo de eso, la vacunación no cambia el resultado |

## 6. Calibración con datos reales: COVID-19 en Manta, 2020

| Dato | Valor | Fuente o justificación |
|---|---|---|
| Muertes semanales en Manta 2017-2020 | serie semanal por cantón | Registro Civil del Ecuador, normalizado por [ecuacovid](https://github.com/andrab/ecuacovid) (licencia MIT). Copia procesada en `data/covid_manta_2020.csv` (`scripts/build_covid_manta.py`) |
| Exceso de muertes | muertes de 2020 menos el promedio 2017-2019 de la misma semana | En 2020 Ecuador hizo muy pocas pruebas: el exceso de muertes muestra la forma real de la ola mejor que los casos confirmados (que en Manta tienen saltos y correcciones negativas) |
| Primera ola | semanas 14 a 22; pico en la semana 17 (169 muertes frente a 30 esperadas); ≈ 957 muertes de más | Cálculo propio sobre la serie anterior |
| Crecimiento observado | 8,4 % por día (se duplica cada 8,3 días): pendiente de log(exceso) en las semanas entre el 20 % y el 80 % del pico (14 a 16) | Las muertes van unas semanas detrás de los contagios, pero crecen al mismo ritmo exponencial |
| **R0 calibrado** | **2,35** | Simulamos "sin intervenir" en nuestra Manta para R0 de 1,5 a 3,2 (30 corridas cada uno), medimos el crecimiento diario de los contagios con la misma regla 20-80 % e interpolamos el R0 que da 8,4 %/día (`src/engine/realdata.py`) |
| Validación de forma | la ola real estuvo 5 semanas sobre la mitad del pico; la simulada, 4 | Ecuador entró en cuarentena el 16-17 de marzo de 2020: este R0 reproduce la ola **como ocurrió**, con las medidas de la época |

## 7. Escenarios de ficción (contraste pedido por el jurado)

| Escenario | R0 | Mordido (días) | Zombi (días) | Fuente o justificación |
|---|---|---|---|---|
| Zombi lento (inspirado en el zombi clásico del cine) | 1,25 | 0,5 | 21 | [Alemi et al. 2015, Physical Review E](https://arxiv.org/abs/1503.01104) ajustaron películas de zombis: α = 0,8 (los humanos destruyen zombis a 0,8 veces la tasa a la que los zombis muerden). Cada zombi muerde en promedio 1/α = 1,25 personas antes de ser destruido. Conversión con vida media de 30 minutos. Los zombis no se curan: "Exorcizado" = destruido; 21 días es el tope del modelo (supuesto) |
| Caminantes (inspirado en las series de caminantes) | 1,25 | 1,5 | 21 | Zombis lentos como el zombi clásico (mismo α de Alemi et al.). El mordido tiene fiebre, muere en uno o dos días y se levanta: latencia 1,5 días (**supuesto de ficción**) |
| Horda rápida (inspirada en las hordas rápidas del cine) | 6,0 | 0,5 | 21 | La conversión tarda segundos y los zombis corren en grupo. No hay estimación publicada: R0 = 6 es un **supuesto de ficción**. El modelo es diario y no baja de 1 día de latencia, así que aquí la plaga es más lenta que en la pantalla |
| Influenza H1N1 2009 | 1,46 | 1,5 | 4 | R0 mediano de la pandemia de 2009 (Biggerstaff et al. 2014); incubación de influenza A ≈ 1,4 días (Lessler et al. 2009); 4 días contagioso es un supuesto |

## 8. El mapa

| Dato | Valor | Justificación |
|---|---|---|
| Ubicación de cada persona | su casa, al azar alrededor del centro de su barrio (≈ 600-700 m, solo hacia tierra adentro) | **Supuesto visual:** el modelo no usa coordenadas para contagiar, solo la red de contactos. El mapa repite la corrida 1 de la semilla elegida |
| Estado en el mapa | Mordido durante la latencia media, Zombie durante los días contagiosos medios, luego Exorcizado | Aproximación visual con las duraciones promedio (las de cada persona varían) |
| Mapa base | Esri (gris oscuro e imágenes satelitales) | Gratis con atribución y sin llave de API; Google Maps y CARTO exigen llave |
