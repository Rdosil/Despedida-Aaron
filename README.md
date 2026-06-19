# Despedida Aarón

Sitio estático con persistencia pública de fotos en Vercel Blob.

## Variables de entorno en Vercel

### Obligatorias
- `BLOB_READ_WRITE_TOKEN`

`BLOB_READ_WRITE_TOKEN` lo añade Vercel al conectar el Blob `GeloBlob` al proyecto.

## Comportamiento de la galería

- cualquiera con el enlace puede subir fotos
- cualquiera con el enlace puede reemplazar la foto de un slot
- las fotos reemplazadas se archivan automáticamente en una sección de “outras fotos”
- no hay borrado público

## API

### `GET /api/photos`
Devuelve:
- `slots`: fotos actuales por slot
- `archive`: fotos antiguas archivadas por slot

### `POST /api/photos`
Headers requeridos:
- `content-type`: `image/png`, `image/jpeg`, `image/webp` o `image/avif`
- `x-slot-id`: id del slot (`foto1`, `foto2`, etc.)

Body: binario de la imagen.

## Test local

```bash
npm install
npm run test:persistence
```
