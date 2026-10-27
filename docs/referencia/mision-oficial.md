# Misión oficial · SpookyThon 2026 · Track B · La Plaga Zombie

(Texto copiado de la plataforma del evento, publicado el 26 oct 2026.)

Una plaga se está extendiendo por Manta. Empezó con un solo caso y cada persona mordida contagia a quienes tiene cerca: en la casa, en el bus, en el colegio, en el mercado. No hay vacunas para todos, no se puede cerrar toda la ciudad y cada día hay más zombies.

Cada equipo es el Comité de Contención: construye la herramienta que le diga a la ciudad qué hacer, dónde y cuándo para que la plaga alcance a la menor cantidad de gente posible.

**Problemática real:** cuando llega un brote, las autoridades de salud deciden rápido y con recursos limitados: a quién vacunar primero, qué lugares cerrar, dónde fumigar. La COVID-19 lo dejó claro, y en Manabí el dengue lo recuerda cada temporada de lluvias.

**Utilidad real:** es, en pequeño, lo que usan los ministerios de salud para planificar vacunación, fumigación o cierres de escuelas. El mismo motor sirve para frenar la desinformación, contener virus informáticos o hacer viral un producto.

## 01 Objetivo
Construir una herramienta que simule cómo se propaga una enfermedad en una población y encuentre la mejor estrategia de intervención con recursos limitados, mostrando con números cuánta gente se salva frente a no hacer nada o actuar al azar.

La organización NO entrega datos, vacunas ni enfermedades: cada equipo diseña su escenario y su solución. Se evalúa qué tan bien piensan el problema y qué tan sólida es su respuesta.

## 02 Requisitos
**Cada equipo decide:**
- La plaga: inspirada en una enfermedad real (dengue, influenza, sarampión, COVID, cólera) o inventada; transmisión, incubación, contagio, si mata o convierte.
- La población: red de contactos de Manta generada por ellos (hogares, colegios, buses, mercados, barrios) o con datos abiertos (INEC, Ministerio de Salud).
- El modelo: SIR, SEIR, basado en agentes, sobre grafo o por barrios.
- Las intervenciones: vacunas, cuarentenas, cierre de lugares, fumigación, antídotos, campañas.
- Los recursos: cuántos hay, si llegan por días, cuánto cuestan.
- La estrategia: centralidad en el grafo, algoritmos voraces, optimización, simulaciones, aprendizaje por refuerzo o heurística propia.

Estados sugeridos: 🟢 Sano (susceptible) · 🟡 Mordido (expuesto) · 🔴 Zombie (infeccioso) · 🔵 Exorcizado (recuperado o inmune).

**El sistema DEBE:**
1. Simular la propagación día a día.
2. Aplicar al menos una intervención con recursos limitados.
3. Comparar su estrategia contra dos líneas base: no intervenir e intervenir al azar con los mismos recursos.
4. Repetir la simulación muchas veces y reportar promedios y rangos.
5. Tener una interfaz para cambiar los parámetros principales (contagio, vacunas, punto de inicio) y ver el resultado.
6. Ser reproducible: misma configuración y semilla, mismo resultado.
7. Estar desplegado en AWS.
8. Documentar en el README cada supuesto y de dónde salen los números.

**Nivel Base:** modelo SIR o SEIR sobre una red de contactos, una intervención (por ejemplo K vacunas) y una estrategia razonable comparada con las dos líneas base. Gráfica de la curva de contagios y resumen de cuántos se salvan.

**Nivel Pro (puntos extra):** varias intervenciones combinadas con costos y un presupuesto total; recursos que llegan por días y decisiones que cambian según el brote; miles de simulaciones en paralelo en AWS (Monte Carlo); calibración con datos reales (por ejemplo dengue en Manabí); mapa animado del avance de la plaga; informe para el alcalde en lenguaje simple.

Ideas de dirección (opcionales): vacunación estratégica, reparto de antídotos, cuarentena inteligente, plaga por mosquito con brigadas de fumigación, rastreo del paciente cero, hospital saturado.

## 03 Reglas
- Cada equipo DEBE trabajar en su propia cuenta de AWS. Región libre, documentada en el README.
- Créditos: cuentas nuevas del plan gratuito reciben hasta USD 200 (100 al registrarse + hasta 100 por tareas de introducción).
- La cuenta DEBE tener un AWS Budget con alerta desde el primer día (captura en el README).
- Se permite usar asistentes de IA, pero el equipo DEBE poder explicar cualquier parte de su código.
- Lenguajes y frameworks libres.
- DEBE = obligatorio (si no se cumple, ese criterio vale 0). DEBERÍA = esperado (resta). PUEDE = opcional (suma).

**Rúbrica (sobre 10):** Prueba de fuego 40 % · Calidad técnica 25 % (arquitectura, seguridad básica: sin llaves en el código, mínimo privilegio, código legible) · Producto 15 % (usable sin explicación) · Costos 10 % (declaración coherente con la cuenta) · Presentación 10 %. Empate: mejor prueba de fuego; luego menor costo declarado.

**Prueba de fuego:** (1) presentación del escenario; (2) el jurado corre la simulación en vivo con una semilla que elige y comprueba que la estrategia supera a las líneas base; (3) Brote Sorpresa: el jurado cambia condiciones (doble de contagiosa, mitad de vacunas, brote empieza en el mercado, variante que la vacuna cubre a medias) y el equipo tiene 5 minutos para ajustar y mostrar la nueva recomendación. Puntuación: Impacto 30 % · Rigor 25 % · Brote Sorpresa 25 % · Claridad para decidir 20 %.

**El jurado busca:** una sola simulación con buen resultado; no tener línea base; parámetros inventados sin explicar; vacunar a quien ya está infectado o es inmune; modelo tan complejo que el equipo no sabe explicar; estrategias que se rompen con el Brote Sorpresa.

## 04 Entregables (hasta el miércoles 28 de octubre, 10:00 hora de Ecuador)
- Repositorio público con código completo e historial de commits real.
- README en la raíz: qué hace, cómo desplegarlo, cómo probarlo, decisiones de diseño, limitaciones y captura del AWS Budget.
- Diagrama de arquitectura en el repo (PNG/SVG + fuente) enlazado desde el README.
- Declaración de costos (README o docs/costos.md): costo mensual con cálculo visible y gasto real del evento.
- App desplegada en AWS con URL pública viva hasta el pitch.
- Presentación del pitch (PDF/PPT/PPTX, máx. 20 MB). Video opcional.
- Track B: parámetros por defecto y semilla documentados en el README.

Estructura sugerida: README.md, docs/arquitectura.png + .drawio, docs/costos.md, docs/budget.png, src/, infra/.

Demo en vivo: viernes 30 de octubre en la ULEAM, 5 min de pitch + 3 min de preguntas.

## 05 Servicios AWS sugeridos (ninguno obligatorio)
Lambda, ECS Fargate o Batch para simular; Step Functions (Distributed Map) o Batch para miles en paralelo; S3 + Athena o DynamoDB para resultados; Amplify o S3 + CloudFront para la interfaz; SageMaker opcional; Bedrock para el informe en lenguaje simple; CloudWatch para monitoreo.
