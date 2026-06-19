# Despedida Aarón

Sitio estático con persistencia de fotos en Vercel Blob.

## Variables de entorno en Vercel

### Obligatorias
- `BLOB_READ_WRITE_TOKEN`
- `ADMIN_TOKEN`

`BLOB_READ_WRITE_TOKEN` lo añade Vercel al conectar el Blob `GeloBlob` al proyecto.

`ADMIN_TOKEN` debes crearlo tú manualmente en **Project Settings → Environment Variables**.

Ejemplo:

```text
una-clave-larga-y-secreta-para-subir-fotos
```

## Cómo activar las subidas en tu navegador

Una vez desplegado, abre la web y en la consola del navegador ejecuta:

```js
localStorage.setItem('despedida_admin_token', 'TU_ADMIN_TOKEN')
```

Recarga la página después de hacerlo.

Desde ese navegador ya podrás:
- subir fotos
- reemplazarlas
- borrarlas
- conservarlas entre sesiones

## API

### `GET /api/photos`
Devuelve los slots persistidos.

### `POST /api/photos`
Headers requeridos:
- `content-type`: `image/png`, `image/jpeg`, `image/webp` o `image/avif`
- `x-admin-token`: tu `ADMIN_TOKEN`
- `x-slot-id`: id del slot (`foto1`, `foto2`, etc.)

Body: binario de la imagen.

### `DELETE /api/photos`
Headers requeridos:
- `x-admin-token`
- `x-slot-id`

## Test local

```bash
npm install
npm run test:persistence
```
