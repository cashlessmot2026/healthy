-- =========================================================
-- Healthy & Tasty · Menú digital
-- Esquema, seguridad (RLS) y funciones RPC.
-- Las credenciales del admin y la API key de Gemini se cargan
-- aparte (no se versionan).
-- =========================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists http with schema extensions;

-- ---------- Tablas ----------
create table if not exists public.restaurants (
  id text primary key,
  name text not null,
  tagline text default '',
  logo text default '',
  menu_image text default '',
  colors jsonb not null default '{}'::jsonb,
  sort int default 0,
  active boolean default true
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  note text default '',
  sort int default 0,
  active boolean default true
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text default '',
  price int not null default 0,
  image text default '',
  options jsonb default '[]'::jsonb,   -- [{"name":"Salsa","choices":["Ají","Ahogado"]}]
  allow_half boolean default false,     -- pizzas por mitades
  tags text default '',
  sort int default 0,
  active boolean default true
);

create table if not exists public.extras (
  id uuid primary key default gen_random_uuid(),
  restaurant_id text not null references public.restaurants(id) on delete cascade,
  name text not null,
  price int not null default 0,
  kind text not null default 'adicional' check (kind in ('adicional','borde')),
  category_ids uuid[] default '{}',     -- vacío = aplica a todas las categorías
  sort int default 0,
  active boolean default true
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  created_at timestamptz default now(),
  source text default 'menu',
  table_no text default '',
  items jsonb not null default '[]'::jsonb,
  total int not null default 0,
  notes text default '',
  status text default 'nuevo',            -- nuevo | preparando | listo | entregado | cancelado
  customer_name text default '',
  customer_phone text default '',
  address text default '',
  lat double precision,
  lng double precision,
  order_type text default 'mesa',         -- mesa | domicilio
  client_phone text default '',           -- solo para que el cliente recupere su pedido; el admin no lo muestra en pedidos de mesa
  updated_at timestamptz default now()
);
alter table public.orders add column if not exists client_phone text default '';
alter table public.orders add column if not exists order_type text default 'mesa';
alter table public.orders add column if not exists customer_phone text default '';
alter table public.orders add column if not exists address text default '';
alter table public.orders add column if not exists lat double precision;
alter table public.orders add column if not exists lng double precision;
alter table public.orders add column if not exists customer_name text default '';
alter table public.orders add column if not exists updated_at timestamptz default now();

create table if not exists public.settings (key text primary key, value text);
create table if not exists public.secrets  (key text primary key, value text);
create table if not exists public.admins   (username text primary key, pass_hash text not null);
create table if not exists public.admin_sessions (
  token uuid primary key default gen_random_uuid(),
  username text not null references public.admins(username) on delete cascade,
  expires_at timestamptz default now() + interval '12 hours'
);

-- ---------- RLS ----------
alter table public.restaurants    enable row level security;
alter table public.categories     enable row level security;
alter table public.products       enable row level security;
alter table public.extras         enable row level security;
alter table public.orders         enable row level security;
alter table public.settings       enable row level security;
alter table public.secrets        enable row level security;
alter table public.admins         enable row level security;
alter table public.admin_sessions enable row level security;

drop policy if exists "lectura publica" on public.restaurants;
drop policy if exists "lectura publica" on public.categories;
drop policy if exists "lectura publica" on public.products;
drop policy if exists "lectura publica" on public.extras;
drop policy if exists "lectura publica" on public.settings;
create policy "lectura publica" on public.restaurants for select using (true);
create policy "lectura publica" on public.categories  for select using (true);
create policy "lectura publica" on public.products    for select using (true);
create policy "lectura publica" on public.extras      for select using (true);
create policy "lectura publica" on public.settings    for select using (true);

-- Nada de escritura directa desde el navegador: todo pasa por funciones.
revoke insert, update, delete on public.restaurants, public.categories, public.products,
  public.extras, public.orders, public.settings from anon, authenticated;
revoke all on public.secrets, public.admins, public.admin_sessions, public.orders from anon, authenticated;

-- ---------- Auth admin ----------
create or replace function public._admin_check(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare u text;
begin
  select username into u from admin_sessions where token = p_token and expires_at > now();
  if u is null then raise exception 'Sesión expirada, vuelve a iniciar sesión' using errcode = '28000'; end if;
  return u;
end $$;
revoke execute on function public._admin_check(uuid) from public, anon, authenticated;

create or replace function public.admin_login(p_user text, p_pass text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare t uuid;
begin
  if not exists (select 1 from admins where username = lower(trim(p_user)) and pass_hash = crypt(p_pass, pass_hash)) then
    perform pg_sleep(0.6);
    raise exception 'Usuario o contraseña incorrectos';
  end if;
  delete from admin_sessions where expires_at < now();
  insert into admin_sessions(username) values (lower(trim(p_user))) returning token into t;
  return t;
end $$;

create or replace function public.admin_logout(p_token uuid) returns void
language sql security definer set search_path = public as $$
  delete from admin_sessions where token = p_token;
$$;

create or replace function public.admin_change_password(p_token uuid, p_new text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u text := _admin_check(p_token);
begin
  if length(coalesce(p_new,'')) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  update admins set pass_hash = crypt(p_new, gen_salt('bf')) where username = u;
end $$;

-- Guardar (insertar o actualizar) cualquier fila del menú
create or replace function public.admin_save(p_token uuid, p_table text, p_row jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cols text; res jsonb; r jsonb := p_row;
begin
  perform _admin_check(p_token);
  if p_table = 'settings' then
    insert into settings(key, value) values (r->>'key', r->>'value')
      on conflict (key) do update set value = excluded.value
      returning to_jsonb(settings.*) into res;
    return res;
  end if;
  if p_table not in ('restaurants','categories','products','extras') then
    raise exception 'Tabla no permitida';
  end if;
  if coalesce(r->>'id','') = '' then
    if p_table = 'restaurants' then raise exception 'El restaurante necesita un id'; end if;
    r := r || jsonb_build_object('id', gen_random_uuid());
  end if;
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = p_table and column_name <> 'id' and r ? column_name;
  if cols is null then raise exception 'No hay columnas para guardar'; end if;
  execute format(
    'insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1)
       on conflict (id) do update set %2$s returning to_jsonb(%1$I.*)', p_table, cols)
    into res using r;
  return res;
end $$;

create or replace function public.admin_delete(p_token uuid, p_table text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _admin_check(p_token);
  if p_table not in ('restaurants','categories','products','extras','orders') then
    raise exception 'Tabla no permitida';
  end if;
  execute format('delete from public.%I where id::text = $1', p_table) using p_id;
end $$;

create or replace function public.admin_orders(p_token uuid, p_limit int default 100) returns setof public.orders
language plpgsql security definer set search_path = public as $$
begin
  perform _admin_check(p_token);
  return query select * from orders order by created_at desc limit least(coalesce(p_limit,100), 500);
end $$;

create or replace function public.admin_order_status(p_token uuid, p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _admin_check(p_token);
  if p_status not in ('nuevo','preparando','listo','entregado','cancelado') then raise exception 'Estado no válido'; end if;
  update orders set status = p_status, updated_at = now() where id = p_id;
end $$;

create or replace function public.admin_set_secret(p_token uuid, p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _admin_check(p_token);
  if p_key not in ('gemini_key') then raise exception 'Clave no permitida'; end if;
  insert into secrets(key, value) values (p_key, p_value)
    on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.admin_secret_status(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform _admin_check(p_token);
  select value into k from secrets where key = 'gemini_key';
  return jsonb_build_object('gemini_key_set', coalesce(k,'') <> '',
    'gemini_key_hint', case when coalesce(k,'') = '' then '' else '••••' || right(k, 4) end);
end $$;

-- ---------- Pedidos públicos ----------
create or replace function public.create_order(p_order jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare c text; o orders;
begin
  if jsonb_typeof(p_order->'items') <> 'array' or jsonb_array_length(p_order->'items') = 0 then
    raise exception 'El pedido está vacío';
  end if;
  if jsonb_array_length(p_order->'items') > 60 then raise exception 'Pedido demasiado grande'; end if;
  c := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=0O1Il', ''), 1, 4));
  insert into orders(code, source, table_no, items, total, notes, customer_name, customer_phone, address, lat, lng, order_type, client_phone)
  values (c, left(coalesce(p_order->>'source','menu'), 10), left(coalesce(p_order->>'table_no',''), 20),
          p_order->'items', coalesce((p_order->>'total')::int, 0), left(coalesce(p_order->>'notes',''), 500),
          left(coalesce(p_order->>'customer_name',''), 60), left(coalesce(p_order->>'customer_phone',''), 30),
          left(coalesce(p_order->>'address',''), 250),
          nullif(p_order->>'lat','')::double precision, nullif(p_order->>'lng','')::double precision,
          case when p_order->>'order_type' = 'domicilio' then 'domicilio' else 'mesa' end,
          left(coalesce(p_order->>'client_phone',''), 30))
  returning * into o;
  return jsonb_build_object('id', o.id, 'code', o.code, 'created_at', o.created_at);
end $$;

-- Estado de un pedido (para el cliente): solo se puede consultar con el id, que es un uuid imposible de adivinar.
create or replace function public.order_status(p_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'code', code, 'status', status, 'total', total, 'table_no', table_no,
                            'customer_name', customer_name, 'created_at', created_at, 'updated_at', updated_at)
    from orders where id = p_id;
$$;
grant execute on function public.order_status(uuid) to anon, authenticated;

-- Recuperar los pedidos recientes de un cliente por su teléfono (si cambia de dispositivo o pierde los datos de la app).
create or replace function public.my_orders(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(d) < 7 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'status', status, 'total', total, 'items', items,
           'table_no', table_no, 'order_type', order_type, 'customer_name', customer_name, 'customer_phone', customer_phone,
           'address', address, 'lat', lat, 'lng', lng, 'created_at', created_at) order by created_at)
      from orders
     where regexp_replace(coalesce(client_phone, ''), '\D', '', 'g') = d
       and created_at > now() - interval '24 hours'
       and (status not in ('entregado', 'cancelado') or updated_at > now() - interval '10 minutes')), '[]'::jsonb);
end $$;
grant execute on function public.my_orders(text) to anon, authenticated;

-- ---------- Mesero IA (Gemini) ----------
-- La API key vive en public.secrets y nunca sale de la base de datos.
-- Llamada única a Gemini con límite de tiempo; nunca lanza excepción.
create or replace function public._gemini_call(p_model text, p_key text, p_body jsonb, p_timeout_ms int) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare resp extensions.http_response;
begin
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', p_timeout_ms::text);
  perform http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '4000');
  begin
    select * into resp from http((
      'POST', 'https://generativelanguage.googleapis.com/v1beta/models/' || p_model || ':generateContent',
      array[http_header('x-goog-api-key', p_key)], 'application/json', p_body::text)::http_request);
  exception when others then
    return jsonb_build_object('ok', false, 'status', 0, 'err', p_model || ': ' || sqlerrm);
  end;
  if resp.status <> 200 then
    return jsonb_build_object('ok', false, 'status', resp.status, 'err', p_model || ': HTTP ' || resp.status);
  end if;
  return jsonb_build_object('ok', true, 'text', (resp.content::jsonb) #>> '{candidates,0,content,parts,0,text}');
exception when others then
  return jsonb_build_object('ok', false, 'status', 0, 'err', p_model || ': ' || sqlerrm);
end $$;
revoke execute on function public._gemini_call(text, text, jsonb, int) from public, anon, authenticated;

create or replace function public.ai_chat(p_messages jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  k text; m text; fb text; mm text; sys text; menu jsonb; body jsonb; contents jsonb;
  gr jsonb; txt text; res jsonb; last_err text; left_ms int; no_think boolean := false;
  t0 timestamptz := clock_timestamp();
begin
  select value into k from secrets where key = 'gemini_key';
  if coalesce(k,'') = '' then raise exception 'El mesero IA aún no está configurado'; end if;
  m := coalesce(nullif((select value from settings where key = 'ai_model'), ''), 'gemini-flash-lite-latest');
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) = 0 or jsonb_array_length(p_messages) > 80 then
    raise exception 'Conversación inválida';
  end if;

  select jsonb_agg(jsonb_build_object(
           'restaurante', r.name, 'restaurante_id', r.id,
           'categorias', (select coalesce(jsonb_agg(jsonb_build_object(
               'categoria', c.name, 'nota', c.note,
               'productos', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', p.id, 'nombre', p.name, 'descripcion', p.description, 'precio', p.price,
                   'opciones', p.options, 'mitades', p.allow_half) order by p.sort), '[]'::jsonb)
                 from products p where p.category_id = c.id and p.active)
             ) order by c.sort), '[]'::jsonb)
             from categories c where c.restaurant_id = r.id and c.active),
           'adicionales', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'nombre', e.name, 'precio', e.price, 'tipo', e.kind,
               'solo_categorias', (select coalesce(jsonb_agg(c2.name), '[]'::jsonb) from categories c2 where c2.id = any(e.category_ids))
             ) order by e.sort), '[]'::jsonb)
             from extras e where e.restaurant_id = r.id and e.active)
         ) order by r.sort)
    into menu
    from restaurants r where r.active;

  sys := coalesce((select value from settings where key = 'ai_prompt'), '')
         || E'\n\nCARTA ACTUAL (JSON, precios en pesos colombianos):\n' || coalesce(menu::text, '[]');

  select jsonb_agg(jsonb_build_object(
           'role', case when e->>'role' = 'model' then 'model' else 'user' end,
           'parts', jsonb_build_array(jsonb_build_object('text', left(coalesce(e->>'text',''), 4000)))))
    into contents
    from jsonb_array_elements(p_messages) e;

  body := jsonb_build_object(
    'system_instruction', jsonb_build_object('parts', jsonb_build_array(jsonb_build_object('text', sys))),
    'contents', contents,
    'generationConfig', jsonb_build_object('responseMimeType', 'application/json', 'temperature', 0.6,
                                           'thinkingConfig', jsonb_build_object('thinkingLevel', 'minimal')));

  -- Gemini a veces se cuelga sin responder: intento corto con el modelo principal,
  -- y si falla, reintento con el modelo de respaldo. Todo dentro de ~27 s.
  fb := coalesce(nullif((select value from settings where key = 'ai_fallback_model'), ''), 'gemini-3.1-flash-lite');
  foreach mm in array array[m, fb, m] loop
    left_ms := 27000 - (extract(epoch from clock_timestamp() - t0) * 1000)::int;
    exit when left_ms < 2500;
    gr := _gemini_call(mm, k, case when no_think then body #- '{generationConfig,thinkingConfig}' else body end, least(left_ms, 9000));
    if (gr->>'ok')::boolean then txt := gr->>'text'; exit; end if;
    last_err := gr->>'err';
    -- 400 = el modelo no acepta thinkingConfig: se repite sin él
    no_think := no_think or (gr->>'status') = '400';
  end loop;

  if txt is null then
    raise exception 'El mesero IA no respondió a tiempo (%)', left(coalesce(last_err, ''), 120);
  end if;
  begin
    res := txt::jsonb;
  exception when others then
    res := jsonb_build_object('reply', coalesce(txt, 'Disculpa, ¿me repites por favor?'));
  end;
  return res;
end $$;

insert into public.settings (key, value) values ('ai_fallback_model', 'gemini-3.1-flash-lite') on conflict (key) do nothing;

-- ---------- Llamar al mesero ----------
create table if not exists public.waiter_calls (
  id uuid primary key default gen_random_uuid(),
  table_no text not null,
  customer_name text default '',
  created_at timestamptz default now(),
  attended_at timestamptz
);
alter table public.waiter_calls enable row level security;
revoke all on public.waiter_calls from anon, authenticated;

-- El cliente llama al mesero (una sola llamada pendiente por mesa).
create or replace function public.call_waiter(p_table text, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare t text := left(trim(coalesce(p_table, '')), 20); w waiter_calls;
begin
  if t = '' then raise exception 'Indica tu número de mesa'; end if;
  select * into w from waiter_calls where table_no = t and attended_at is null order by created_at desc limit 1;
  if found then return jsonb_build_object('id', w.id, 'already', true); end if;
  insert into waiter_calls(table_no, customer_name) values (t, left(coalesce(p_name, ''), 60)) returning * into w;
  return jsonb_build_object('id', w.id, 'already', false);
end $$;

create or replace function public.waiter_call_status(p_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('attended', attended_at is not null) from waiter_calls where id = p_id;
$$;

create or replace function public.admin_calls(p_token uuid) returns setof public.waiter_calls
language plpgsql security definer set search_path = public as $$
begin
  perform _admin_check(p_token);
  return query select * from waiter_calls where attended_at is null order by created_at;
end $$;

create or replace function public.admin_call_done(p_token uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _admin_check(p_token);
  update waiter_calls set attended_at = now() where id = p_id;
  delete from waiter_calls where attended_at < now() - interval '2 days';
end $$;

-- La llamada a Gemini puede tardar unos segundos.
alter role anon set statement_timeout = '30s';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
