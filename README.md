# 🎃 Concurso de Disfraces — votación en vivo

Una sola página con tres vistas:

| Link | Para quién | Qué hace |
|---|---|---|
| `https://TU-USUARIO.github.io/TU-REPO/` | Invitados (el QR apunta aquí) | Entrar como concursante (con código) o como votante, y votar |
| `…/#tv` | La pantalla o TV | QR, barras grises en vivo, "¡se acabó el tiempo!", animación de eliminados y ganador |
| `…/#host` | El host | Tomar fotos, ver códigos, configurar rondas, abrir y cerrar votaciones, revelar |

Hosting: **GitHub Pages** (gratis). Backend: **Supabase** (gratis), que guarda base de datos, fotos y tiempo real.

---

## 0. Probarlo ya (modo demo, sin instalar nada)

Si `js/config.js` no tiene datos de Supabase, la página corre en **modo demo**: todo se guarda en tu navegador y las pestañas se sincronizan entre sí.

1. Sirve la carpeta con cualquier servidor local, por ejemplo `python -m http.server 5180`, y abre `http://localhost:5180/#host`.
2. Zona peligrosa → **Cargar 20 disfraces de prueba**.
3. Abre **📺 Abrir TV** en otra pestaña.
4. En el host: Comenzar concurso → Abrir votación → **🤖 Simular 40 votantes** → Cerrar → **✨ Revelar**.

> Abrir `index.html` con doble clic no funciona; los módulos de JavaScript necesitan un servidor, aunque sea local.

---

## 1. Crear el backend en Supabase (~10 min)

1. Entra a <https://supabase.com>, crea una cuenta y un **New project**. Elige la región más cercana (por ejemplo East US) y guarda la contraseña de la base de datos.
2. Ve a **SQL Editor → New query**. Abre [`supabase/schema.sql`](supabase/schema.sql) y **cambia el correo de la última línea** (`host@ejemplo.com`) por el del host. Pega todo y dale **Run**. Debe decir *Success*.
3. **Crea el usuario del host:** Authentication → Users → **Add user → Create new user**, con el mismo correo y una contraseña. Marca *Auto Confirm User*.
4. Recomendado: Authentication → Sign In / Providers, desactiva **Allow new users to sign up**. Igual nadie más puede manejar el concurso, porque solo el correo de la tabla `admins` es host.
5. Ve a **Project Settings → API** (o *API Keys*) y copia:
   - **Project URL**, algo como `https://abcd1234.supabase.co`
   - **Publishable key**, que empieza con `sb_publishable_…`. Es la que recomienda Supabase; las llaves `anon` de antes se dejan de usar a finales de 2026, aunque la página también funciona con ellas.
6. Pégalos en [`js/config.js`](js/config.js):

```js
export const SUPABASE_URL = 'https://abcd1234.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

> La publishable key está hecha para ir en el código público: tiene los mismos permisos bajos que la `anon`. La seguridad la ponen las reglas de la base de datos: los invitados solo pueden votar mediante la función `cast_vote`, que revisa todas las reglas. **Nunca** pongas la `service_role` key.

---

## 2. Publicar en GitHub Pages (~5 min)

1. En GitHub crea un repo **público**, por ejemplo `disfraces`.
2. **Add file → Upload files** y arrastra todo el contenido de esta carpeta: `index.html`, `css/`, `js/`, `supabase/` y `README.md`. Luego Commit.
3. Ve a **Settings → Pages → Build and deployment**: Source *Deploy from a branch*, Branch `main` y carpeta `/ (root)`. Guarda.
4. En 1 o 2 minutos queda en `https://TU-USUARIO.github.io/disfraces/`.

Para cambiar algo después (título, colores…), edita el archivo en GitHub y Pages se actualiza solo.

**Dominio propio, más adelante:** Settings → Pages → *Custom domain*.

---

## 3. Prueba general (el 29, un día antes) ✅

- [ ] Abre `/#host` en el celular del host, inicia sesión y agrega a 3 personas de prueba **con foto real**.
- [ ] Abre `/#tv` en la laptop o TV y revisa que salgan las fotos y el QR.
- [ ] Con 2 o 3 celulares: escanea el QR. Uno entra con código (debe salirle "Tú 👻" y no poder votarse) y otro como votante.
- [ ] Haz una ronda con temporizador de 30 s y revisa que la TV diga **¡SE ACABÓ EL TIEMPO!** sola.
- [ ] Revela y mira la animación en la TV.
- [ ] Zona peligrosa → **Reiniciar concurso**, y borra a los de prueba con la ✕.

---

## 4. El día de la fiesta 🎃

**Durante la llegada o el desfile:**
1. El host abre `/#host`. Por cada disfraz: **📷 Tomar foto** con la cámara, o **🖼️ Subir foto** si alguien la mandó antes (galería del celular o archivos de la compu; en la compu también se puede arrastrar al recuadro). Se abre un **editor para encuadrar**: arrastra para mover, pellizca o usa la barra para acercar. *Foto completa* deja ver toda la foto y rellena los lados con la misma foto desenfocada, útil para fotos horizontales o de grupo. Luego escribe el nombre y dale **Agregar**. La foto se guarda en 960×1280 (3:4), el formato de todas las tarjetas.
2. Aparece un **código grande y un QR personal**. La persona lo escanea con su celular, o escribe el código, y queda ligada a su disfraz: así **no puede votar por sí misma**.
3. La TV (`/#tv`) va mostrando a todos los que se registran.

**Rondas:** en el panel → *Rondas* escribe cuántos pasan, por ejemplo `25, 10, 5, 1`. Los votos por persona se calculan solos (3, 2, 2, 1) y se pueden ajustar.

| Rondas | Votos por persona |
|---|---|
| 3 | 3, 2, 1 |
| 4 | 3, 2, 2, 1 |
| 5 | 3, 3, 2, 2, 1 |

Si llegan menos personas que el primer corte, el sistema se salta a la ronda que tenga sentido.

**Cada ronda:**
1. **Abrir votación**, eligiendo tiempo (30 s, 1 min… o sin límite). Los celulares muestran los disfraces que siguen en concurso. Si alguien quiere enviar menos votos de los que tiene, la página le avisa cuántos le faltan antes de enviar. Una vez enviado, **el voto ya no se puede cambiar**.
2. La TV muestra **barras grises sin nombres** con la línea de **corte**: se ve si está reñido, pero no quién va ganando.
3. Se acaba el tiempo (o el host pica **Cerrar**) y la TV muestra **¡SE ACABÓ EL TIEMPO!**
4. **✨ Revelar**, estilo Fall Guys:
   - Cuenta regresiva 3-2-1.
   - Aparecen todos **en orden al azar**, sin votos.
   - Los eliminados se van marcando uno por uno, en orden aleatorio y a ritmo constante: la foto **se pone en gris** y el borde, el brillo y el sello toman el **color del tema**, para que se distingan bien. Clásico: rojo, ELIMINADO. Zombie: verde tóxico, INFECTADO. Muertos: rosa mexicano, AL MÁS ALLÁ. Se **quedan en su lugar**. Arriba a la derecha, un contador marca cuántos van (por ejemplo "INFECTADOS 4 / 12").
   - Cuando ya están todos marcados, **caen a la vez**, cada uno con su propio retraso, giro y dirección al azar.
   - Los que se salvaron se acomodan por lugar, con votos y medallas 🥇🥈🥉 para los 3 primeros.
   - En la final, el ganador queda con corona y confeti. Luego se hace a un lado y aparece **su camino**: una gráfica de su lugar en cada ronda y una tabla con lugar y votos por ronda.
5. **Siguiente ronda →**, o antes **Presentar (desfile)**.

**Modo desfile** (🎃 / 🧟 / 💀 según el tema): el botón *Presentar* está en Registro, antes de abrir la votación y después de revelar.
- La TV muestra a todos los que siguen en concurso.
- En el panel, el host toca a alguien y sale **en pantalla completa** en la TV ("Desfilando: …"). Tocándolo otra vez se quita.
- Desde ahí mismo está **Siguiente ronda →**, o *Salir del desfile*.
- Los celulares muestran quién está desfilando.

**Temas:** en el panel → *Tema de la fiesta* hay tres opciones, y cambian al instante en la TV y en todos los celulares:
- 🎃 **Halloween clásico**
- ☣️ **Apocalipsis zombie**: cinta de precaución, sangre, sirena roja y "INFECTADO"
- 💀 **Noche de Muertos**: papel picado, cempasúchil y "AL MÁS ALLÁ"

**Volver a empezar (para pruebas):** al terminar, el panel muestra **↺ Nuevo concurso**. También está en Zona peligrosa → *Reiniciar concurso*. Se borran rondas y votos y regresa a "Registro", pero los disfraces se quedan.

**Concurso nuevo con otra gente:** Zona peligrosa → **🗑️ Borrar todos los concursantes**. Reinicia el concurso y borra a todos los concursantes, con sus fotos y códigos. No se puede deshacer. Si algún celular sigue mostrando el nombre de alguien del concurso anterior, se toca el nombre y se elige *Cambiar*.

> Hay **un solo concurso a la vez**. Para dos concursos simultáneos: crea otro proyecto de Supabase, corre ahí el mismo SQL y haz otra copia del repo cambiando solo `js/config.js`.

**Reglas:**
- **Empate en el corte:** pasan todos los empatados. La TV dice, por ejemplo, "¡Pasan 27…!" aunque el corte fuera 25.
- **Si la línea de corte cae en 0 votos:** pasan solo los que tienen votos.
- **Empate en la final:** aparece el botón **⚔️ Ronda de desempate**, solo con los empatados y 1 voto por persona.
- **Ganador:** pantalla con corona 👑 y confeti.

**Trucos:**
- **👀 Ver conteo real (spoiler)** en el panel muestra los votos con nombres solo al host.
- **+30 s** alarga el tiempo si la gente sigue votando.
- Si alguien cambia de celular, en el panel se pica su código (`K7P2`) y vuelve a salir su QR personal.
- La TV en pantalla completa: **F11** en el navegador.

---

## Seguridad: qué sí y qué no

- ✅ Un voto por ronda por celular: lo revisa la base de datos.
- ✅ Nadie puede votarse a sí mismo una vez que ligó su celular con su código: lo revisa la base de datos.
- ✅ No se puede votar después de que se acaba el tiempo, aunque alguien tenga la página abierta.
- ✅ Los votos con nombre son secretos hasta que el host revela.
- ⚠️ Alguien muy tramposo podría votar otra vez abriendo una ventana de incógnito, porque cuenta como celular nuevo. Para una fiesta suele ser suficiente.
- ⚠️ Hace falta internet (wifi o datos) en la fiesta, para todos y para la TV.

## Archivos

```
index.html            la página (una sola)
css/styles.css        estilos, animaciones y colores de cada tema
css/themes.css        medallas y adornos de cada tema
js/themes.js          textos de cada tema
js/config.js          ← aquí van los datos de Supabase
js/app.js             arranque y rutas (/, #tv, #host)
js/view-voter.js      vista de invitados
js/view-tv.js         vista de la TV
js/reveal.js          animación de eliminación y ganador
js/view-host.js       panel del host
js/cropper.js         editor para encuadrar la foto
js/logic.js           reglas: rondas, votos, empates, desempate
js/backend-supabase.js  conexión a Supabase
js/backend-demo.js      modo demo (sin servidor)
supabase/schema.sql   tablas, seguridad y funciones (pegar en Supabase)
```
