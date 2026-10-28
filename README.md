# Healthy & Tasty · Menú digital

PWA en React (un solo código, sin compilación) conectada a Supabase.

| Página | URL | Qué hace |
|---|---|---|
| Menú digital | `/` | Carta con categorías (Postres, Sándwiches, Café, Bebidas sin café). El cliente arma el pedido, lo confirma y ve el estado en vivo en su ticket. |
| Cliente rápido | `/rapido/` | El cliente entra con su nombre (y mesa), pide y sigue el estado de su pedido (Recibido → Preparando → Listo → Entregado). Cuando todo se entrega, su sesión se cierra sola. |
| Mesero IA | `/ia/` | "Leo", mesero virtual con Google Gemini (voz y texto). Recomienda de la carta real y envía el pedido. |
| Admin (oculto) | `/admin/` | Productos, categorías, adicionales, datos del local, pedidos (cambiar estado), ajustes de la IA, códigos QR y contraseña. |

- Todo se agrega por mesa con `?mesa=5` en cualquier URL.
- La API key de Gemini y la contraseña del admin viven solo en la base de datos (tablas privadas con RLS); la IA se llama desde Postgres (`ai_chat`).
- Base de datos: `supabase/schema.sql` (tablas, RLS y funciones) y `supabase/seed.sql` (carta inicial).
