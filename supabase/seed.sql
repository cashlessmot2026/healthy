-- =========================================================
-- Carga inicial del menú de Healthy & Tasty (transcrito de la carta original).
-- Solo se ejecuta si la tabla restaurants está vacía.
-- Los adicionales de salsa/mermelada no tienen precio en la carta: quedan en $0 (editables en /admin).
-- =========================================================
do $seed$
declare
  c_postres uuid := gen_random_uuid();
  c_sand    uuid := gen_random_uuid();
  c_cafe    uuid := gen_random_uuid();
  c_sincafe uuid := gen_random_uuid();
begin
if exists (select 1 from public.restaurants) then
  raise notice 'Menú ya cargado, no se modifica.';
  return;
end if;

insert into public.restaurants (id, name, tagline, logo, menu_image, colors, sort) values
('healthy', 'Healthy & Tasty', 'Postres sin azúcar refinada · Sándwiches de masa madre · Café de especialidad',
 'assets/logos/healthy.png', 'assets/menus/carta-postres.jpg,assets/menus/carta-cafe.jpg',
 '{"bg":"#FDF1F2","card":"#FFFFFF","primary":"#0F3D2C","secondary":"#F7ADB6","accent":"#F7ADB6","text":"#0F3D2C","muted":"#5E7468","onPrimary":"#FDF1F2"}', 1);

insert into public.categories (id, restaurant_id, name, note, sort) values
(c_postres, 'healthy', 'Postres', 'Endulzados con alulosa, stevia y azúcar de coco', 1),
(c_sand,    'healthy', 'Sándwiches', 'Todos en pan de masa madre', 2),
(c_cafe,    'healthy', 'Café', '', 3),
(c_sincafe, 'healthy', 'Bebidas sin café', '', 4);

insert into public.products (restaurant_id, category_id, name, description, price, options, sort) values
('healthy', c_postres, 'Vasca', 'Cheesecake vasco con salsa de frutos rojos o arequipe. Endulzado con alulosa y stevia', 28000,
  '[{"name":"Salsa","choices":["Frutos rojos","Arequipe"]}]', 1),
('healthy', c_postres, 'Banana Cake', 'Torta de banana a base de harina de arroz. Endulzada con alulosa y azúcar de coco', 16000, '[]', 2),
('healthy', c_postres, 'Cookie Melt', 'Galleta de almendras con helado. Endulzado con alulosa', 23000, '[]', 3),
('healthy', c_postres, 'Brownie Melt', 'Brownie de almendras con helado de vainilla y salsa de arequipe, endulzado con alulosa', 23000, '[]', 4),
('healthy', c_postres, 'Affogato', 'Espresso + Helado + Brownie', 22000, '[]', 5),
('healthy', c_postres, 'Double Melt', 'Copa de helado doble endulzado con stevia y alulosa con salsa de arequipe, chocolate o frutos rojos', 22000,
  '[{"name":"Sabor","choices":["Vainilla","Coco","Frutos rojos","Mango"]},{"name":"Salsa","choices":["Arequipe","Chocolate","Frutos rojos"]}]', 6),

('healthy', c_sand, 'Tuna Melt', 'Pan de masa madre, queso mozzarella y atún cremoso con yogurt griego', 26000, '[]', 1),
('healthy', c_sand, 'Chicken Pesto', 'Pan de masa madre, pollo en salsa pesto y queso mozzarella', 26000, '[]', 2),
('healthy', c_sand, 'Pepper Ham', 'Pan de masa madre, jamón de cerdo, queso pepper jack y salsa de ajo', 26000, '[]', 3),

('healthy', c_cafe, 'Espresso', '', 5000, '[]', 1),
('healthy', c_cafe, 'Espresso Doble', '', 6000, '[]', 2),
('healthy', c_cafe, 'Americano', '', 7000, '[]', 3),
('healthy', c_cafe, 'Cappuccino', '', 11000, '[]', 4),
('healthy', c_cafe, 'Latte', '', 11000, '[]', 5),
('healthy', c_cafe, 'Latte Frío', 'Opcional salsa de arequipe', 12000, '[]', 6),
('healthy', c_cafe, 'Coconut Americano', 'Shot de espresso en agua de coco', 10000, '[]', 7),

('healthy', c_sincafe, 'Matcha Latte', 'Opcional mermelada de mango o frutos rojos', 16000, '[]', 1),
('healthy', c_sincafe, 'Coconut Matcha', 'Matcha en agua de coco. Opcional mermelada de mango o frutos rojos', 18000, '[]', 2),
('healthy', c_sincafe, 'Botella de Agua', '', 8000, '[]', 3),
('healthy', c_sincafe, 'Flor de Jamaica', '', 7000, '[]', 4),
('healthy', c_sincafe, 'Aromática', '', 5000, '[]', 5);

insert into public.extras (restaurant_id, name, price, kind, category_ids, sort) values
('healthy', 'Leche vegetal', 4000, 'adicional', array[c_cafe, c_sincafe], 1),
('healthy', 'Salsa de arequipe', 0, 'adicional', array[c_cafe], 2),
('healthy', 'Mermelada de mango', 0, 'adicional', array[c_sincafe], 3),
('healthy', 'Mermelada de frutos rojos', 0, 'adicional', array[c_sincafe], 4);

insert into public.settings (key, value) values
('ai_model', 'gemini-flash-lite-latest'),
('ai_fallback_model', 'gemini-3.1-flash-lite'),
('ai_prompt', $prompt$Eres "Leo", el mesero virtual de Healthy & Tasty, una cafetería saludable con postres sin azúcar refinada (endulzados con alulosa, stevia y azúcar de coco), sándwiches en pan de masa madre, café de especialidad y bebidas como matcha. El cliente te habla desde su mesa tras escanear un código QR.

PERSONALIDAD: cálido, amable y servicial, como un buen mesero colombiano. Tutea con respeto. Frases cortas y naturales (máximo 2-3 oraciones por respuesta), porque tu respuesta se leerá en voz alta. Usa como mucho un emoji.

CÓMO ATIENDES:
1. Descubre qué se le antoja: algo dulce, un sándwich, un café, algo sin café, algo liviano o sin azúcar refinada.
2. Sugiere 2 o 3 productos REALES de la carta que encajen, con su precio, y explica brevemente por qué. Pon sus id en "suggestions".
3. Cuando el cliente elija un producto, pregunta las opciones obligatorias que tenga (campo "opciones": por ejemplo la salsa de la Vasca, o el sabor y la salsa del Double Melt).
4. Luego ofrece los adicionales que aplican a esa categoría (por ejemplo leche vegetal, salsa de arequipe o mermelada) y sugiere un café o una bebida para acompañar, o un postre si pidió un sándwich.
5. Pregunta si desea algo más. Cuando no quiera nada más, resume el pedido completo con el total y pide confirmación.
6. Solo cuando el cliente confirme explícitamente el resumen, usa stage "confirmado" y dile que solo falta indicar en la ventana que aparecerá si lo quiere en mesa o a domicilio.

REGLAS:
- NUNCA inventes productos, ingredientes, opciones ni precios: usa solo la CARTA ACTUAL. Si piden algo que no existe, dilo con amabilidad y ofrece lo más parecido.
- Precios en pesos colombianos con formato $28.000.
- Si el cliente cambia o quita algo, actualiza el carrito.
- No des consejos médicos; solo describe lo que dice la carta (por ejemplo, "endulzado con alulosa y stevia").

FORMATO: responde SIEMPRE con un único objeto JSON válido, sin texto extra:
{"reply": "lo que le dices al cliente",
 "suggestions": ["id de producto sugerido", ...],
 "cart": [{"product_id": "id", "half_product_id": null, "qty": 1, "option": "opciones elegidas o null", "extra_ids": ["id de adicional"], "notes": ""}],
 "stage": "explorando" | "eligiendo" | "adicionales" | "confirmando" | "confirmado"}
"cart" es SIEMPRE el pedido completo acumulado hasta ahora (vacío si aún no ha elegido nada). En "option" escribe las opciones así: "Salsa: Arequipe" o "Sabor: Mango · Salsa: Chocolate".$prompt$)
on conflict (key) do nothing;
end
$seed$;
