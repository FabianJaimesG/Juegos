# Publicar Banca y jugar en vivo desde varios dispositivos

La app es un único HTML estático. Para que los jugadores la usen desde sus móviles y **compartan
la misma partida en tiempo real**, necesitas dos cosas: (1) una URL pública donde se sirva la página
(GitHub Pages) y (2) una base de datos en tiempo real gratuita (Firebase) que sincroniza el estado.

---

## 1) Firebase Realtime Database (sincronización en vivo)

1. Entra en <https://console.firebase.google.com> y crea un proyecto gratuito.
2. En el menú lateral: **Build → Realtime Database → Crear base de datos**. Elige una región y
   empieza en **modo de prueba** (o configura las reglas de abajo).
3. Copia la **URL de la base de datos**, tiene esta forma:
   `https://TU-PROYECTO-default-rtdb.firebaseio.com`
4. Reglas mínimas para juego casual (Realtime Database → pestaña **Reglas**):

   ```json
   {
     "rules": {
       "rooms": { ".read": true, ".write": true }
     }
   }
   ```

   ⚠️ Con estas reglas, cualquiera que conozca el código de una sala puede leer y escribir en ella.
   Es aceptable para partidas casuales entre amigos. No guardes datos sensibles.

5. Pega esa URL en el archivo `banca-virtual.html`, en la línea (cerca del inicio, en el `<head>`):

   ```html
   window.BANCA_DEFAULT_FB="https://TU-PROYECTO-default-rtdb.firebaseio.com";
   ```

   Así **todos** los jugadores comparten servidor sin configurar nada; solo se pasan el código de
   sala o el enlace de invitación. (Alternativa: cada dispositivo puede pegar la URL desde el botón
   «🌐 En vivo → Cambiar servidor», pero es más cómodo dejarla fija aquí.)

---

## 2) GitHub Pages (URL pública)

El repositorio ya tiene remoto en GitHub (`FabianJaimesG/Juegos`).

1. Sube esta rama:

   ```bash
   git push -u origin partida-en-vivo
   ```

2. En GitHub: **Settings → Pages**.
   - **Source:** *Deploy from a branch*.
   - **Branch:** `partida-en-vivo` (o `main` si luego fusionas), carpeta `/ (root)`.
   - Guarda.
3. En 1–2 minutos tu app estará en:

   ```
   https://fabianjaimesg.github.io/Juegos/BancaViritual/
   ```

   (El `index.html` redirige al archivo de la app conservando el `?room=`.)

4. **Mantenerse actualizado:** cada vez que hagas `git push` a la rama publicada, GitHub Pages
   vuelve a desplegar automáticamente en un par de minutos. No hay build ni pasos extra.

---

## 3) Cómo juegan

1. Un jugador (el banquero) abre la URL y pulsa **🌐 En vivo → Crear sala nueva**. Aparece un código
   de 4 letras.
2. Pulsa **Copiar enlace de invitación** y lo comparte (WhatsApp, etc.), o dicta el código.
3. Los demás abren el enlace (o entran a la URL y pulsan **🌐 En vivo → Unirme** con el código).
4. Todos ven y editan **la misma partida en vivo**: pagos, cobros, transferencias, turnos y saldos
   se sincronizan al instante en todos los dispositivos.

> Nota técnica: la sincronización usa "el último cambio gana". Si dos personas tocan a la vez, gana
> el último; para partidas casuales funciona bien. Si prefieres, deja que solo el banquero registre
> el dinero y los demás miren.

---

## Resumen rápido
- Sin Firebase configurado → la app funciona igual, pero cada dispositivo lleva su propia partida
  local (como hasta ahora).
- Con Firebase + Pages → partida compartida en vivo entre todos.
