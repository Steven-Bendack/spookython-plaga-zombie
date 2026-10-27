# Brief para Claude · SpookyThon 2026 Track B "La Plaga Zombie"

Carlo te pasa este proyecto. Lee primero, en este orden:
1. `docs/referencia/mision-oficial.md`: el reto oficial (requisitos DEBE, rúbrica, Prueba de fuego, entregables).
2. `docs/referencia/estrategia-tecnica.md`: la estrategia técnica ya acordada (modelo, stack, AWS, plan por bloques, contrato de API). Es la base: síguela, salvo que tu investigación encuentre algo claramente mejor (en ese caso, explica por qué en `docs/decisiones.md`).
3. `docs/referencia/SpookyThon-Track-B-explicado.pdf`: explicación del reto para el equipo.

**Entrega límite: miércoles 28 oct 2026, 10:00 (hora de Ecuador).** Hoy es lunes 26 por la noche.

## Lo que Carlo pidió

> "Haz el comienzo con una fuerza rígida, algo que los otros no se van a inventar. Utiliza lo mejor del Obsidian y lo mejor de la tecnología, busca en Google, haz el prototipo, crea un repo e invita a Steimber."

### 1. Investiga antes de codificar (máximo ~30 min)
- **Obsidian** (bóveda `C:\Users\carlo\Desktop\mi memoria\Mi memoria`, MCP `obsidian` o CLI `obsidian`): busca `🧠 Lecciones y Gotchas para IA.md`, `Fuente de verdad.md`, notas de `Proyectos/` con AWS, Lambda, simulación o la ULEAM, y las preferencias de diseño de Carlo. Usa lo aplicable.
- **Web:** lo más actual y sólido en inmunización de redes (acquaintance immunization, collective influence, vacunación en anillo, estrategias adaptativas con información parcial), datos abiertos de Manta (INEC Censo 2022: población, tamaño de hogar, pirámide de edades) y parámetros epidemiológicos con fuente (incubación, periodo infeccioso, R0 de influenza/COVID). Cada número que uses va con su fuente en `docs/supuestos.md`.

### 2. El diferenciador: lo que los otros equipos no van a tener
La mayoría va a mostrar "nuestra estrategia vs. azar" con una gráfica. Nosotros mostramos que **la estrategia aguanta el ataque**. Construye esto como columna vertebral, no como extra:

1. **Torneo con números aleatorios comunes.** Todas las políticas (Nada, Azar, candidatas) corren con las mismas semillas. Se reporta la diferencia pareada por semilla: personas salvadas con intervalo, y **% de semillas en que gana**.
2. **"Modo Jurado" (red team automático).** Un buscador recorre el espacio de Brote Sorpresa (R0, dosis, eficacia, lugar de inicio, retraso de detección) buscando las condiciones donde la estrategia recomendada **pierde** contra Azar. Muestra la **frontera de robustez**: "nuestra estrategia gana en el X % del espacio; solo pierde cuando…". Esto convierte la mayor amenaza de la Prueba de fuego en nuestra mejor diapositiva.
3. **Mapa de decisión precalculado.** Una grilla de condiciones (R0 × dosis × eficacia × inicio) con la mejor estrategia por celda, calculada por Monte Carlo (en local ahora y en AWS Distributed Map después). En el Brote Sorpresa la respuesta aparece al instante y luego se confirma en vivo con la semilla del jurado.
4. **Realismo de información.** Las estrategias solo ven lo observable: Zombies detectados con probabilidad y retraso, no ven a los Mordidos. Se reportan las dosis desperdiciadas en vez de esconderlas.
5. **Certificado de reproducibilidad.** La UI muestra el hash de configuración + semilla + commit, y un enlace "repetir" que codifica toda la configuración en la URL.

Si la investigación encuentra algo mejor que alguno de estos puntos, reemplázalo y justifícalo.

### 3. El prototipo (definición de terminado para esta sesión)
- Motor Python (`src/engine/`), sin dependencias de AWS: población sintética de Manta generada desde la semilla, SEIR diario vectorizado (matrices dispersas), calibración β↔R0, estrategias + líneas base, Monte Carlo pareado, Modo Jurado.
- Tests con pytest en verde: reproducibilidad byte a byte, conservación de la población, nunca vacunar a un no-Sano visible, Azar y Estrategia con las mismas dosis por día, sanidad (R0=0 ⇒ sin brote), calibración ±10 %.
- Interfaz web local funcionando, con controles (R0, dosis/día, eficacia, punto de inicio, semilla, presets de Brote Sorpresa), tres curvas con bandas de rango, tabla de salvados, botón **Recomendar** y vista de Modo Jurado. Diseño limpio (Carlo valora el diseño visual cuidado).
- Infraestructura AWS escrita como SAM en `infra/`, **sin desplegar** (ver restricciones).
- README inicial con cómo correr y probar, defaults y semilla.
- Verifica corriendo todo y muéstrale a Carlo evidencia real (salida de tests, capturas de la UI).

### 4. Repo
- Crea el repo **público** en GitHub con `gh` (la cuenta autenticada es `Steven-Bendack`). Nombre sugerido: `spookython-plaga-zombie`.
- **Historial real:** commits pequeños por pieza que funciona, con conventional commits. **Sin** líneas `Co-Authored-By` ni atribución de IA (regla de Carlo).
- `.gitignore` correcto: nada de `.env`, credenciales ni `node_modules`.

### 5. Invitar a "Steimber"
Carlo lo dictó por voz, así que el usuario exacto de GitHub **no está confirmado**. Busca candidatos (`gh api "search/users?q=steimber"` y variantes por sonido, como steinber o steimberg) y **pregúntale a Carlo cuál es** antes de invitar. Ya confirmado: `gh api -X PUT repos/Steven-Bendack/<repo>/collaborators/<usuario> -f permission=push`.

## Restricciones
- **AWS:** Carlo crea la cuenta y el Budget con alerta. No crees ni despliegues recursos en AWS sin su OK explícito en la conversación. Pídele que revise la cuota de concurrencia de Lambda en Service Quotas.
- Responde a Carlo en español (Ecuador, tú). Código, identificadores y comentarios en inglés; la documentación del README y de `docs/` en español neutro, porque el jurado es local.
- El equipo debe poder explicar todo el código: prefiere claridad a magia. Ningún modelo tan complejo que no se pueda defender en 1 minuto.
- Al cerrar el trabajo: agrega una nota en la bóveda de Obsidian, `Proyectos/SpookyThon 2026 - Plaga Zombie.md`, con las decisiones y el estado.
