-- =====================================================================
-- Kiron · 07_examen.sql  (fase 1, paso 4)
-- Las funciones del ALUMNO para el modo examen. Corrige el SERVIDOR: la solución nunca viaja al móvil.
-- Ejecutar en Supabase → SQL Editor → New query → Run. Se puede repetir sin romper nada.
-- Requiere haber ejecutado antes 01, 03 y 06. No modifica nada existente.
--
-- Cómo funciona (el alumno solo llama a estas funciones, siempre con su código):
--   mis_juegos(codigo)                      → lo que tiene asignado y su estado
--   empezar_partida(codigo, asignacion)     → elige las preguntas (equilibradas), las baraja y empieza el reloj.
--                                             Si ya había una en curso, la REANUDA (recargar o cambiar de móvil no pierde nada).
--   responder(codigo, partida, item, dada)  → guarda y corrige EN EL SERVIDOR. No dice si acertó.
--   evento(codigo, partida, tipo)           → salidas de pestaña, vueltas, cortes de red…
--   terminar_partida(codigo, partida)       → entrega y calcula la nota. La nota NO se ve todavía.
--   mi_resultado(codigo, partida)           → la nota solo aparece cuando el profesor la publica.
-- Reglas: un intento por defecto (lo fija la asignación), el tiempo lo manda el servidor,
-- lo contestado fuera de tiempo no cuenta, y las partidas abandonadas se cierran solas cuando caduca el tiempo.
-- =====================================================================

-- ---------- Corrección de textos y números (misma regla que js/nucleo/preguntas/normalizar.js) ----------
-- Hay una prueba que compara estas dos funciones con las de JavaScript letra por letra.

-- Sin acentos ni diéresis (la ñ cuenta como n), en minúsculas (con tablas propias, sin depender del locale de la base), sin puntuación ni comillas al principio y al final,
-- y con los espacios de dentro reducidos a uno.
create or replace function public._normalizar_texto(s text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           regexp_replace(
             translate(translate(lower(translate(coalesce(s, ''), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǢǣǦǧǨǩǪǫǬǭǮǯǰǴǵǸǹǺǻǼǽǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳʹ;΅Ά·ΈΉΊΌΎΏΐΪΫάέήίΰϊϋόύώϓϔЀЁЃЇЌЍЎЙйѐёѓїќѝўѶѷӁӂӐӑӒӓӖӗӚӛӜӝӞӟӢӣӤӥӦӧӪӫӬӭӮӯӰӱӲӳӴӵӸӹḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼι῁ῂῃῄῆῇῈΈῊΉῌ῍῎῏ῐῑῒΐῖῗῘῙῚΊ῝῞῟ῠῡῢΰῤῥῦῧῨῩῪΎῬ῭΅`ῲῳῴῶῷῸΌῺΏῼ´', 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuUuAaAaÆæGgKkOoOoƷʒjGgNnAaÆæØøAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyʹ;¨Α·ΕΗΙΟΥΩιΙΥαεηιυιυουωϒϒЕЕГІКИУИиеегікиуѴѵЖжАаАаЕеӘәЖжЗзИиИиОоӨөЭэУуУуУуЧчЫыAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyſAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYyααααααααΑΑΑΑΑΑΑΑεεεεεεΕΕΕΕΕΕηηηηηηηηΗΗΗΗΗΗΗΗιιιιιιιιΙΙΙΙΙΙΙΙοοοοοοΟΟΟΟΟΟυυυυυυυυΥΥΥΥωωωωωωωωΩΩΩΩΩΩΩΩααεεηηιιοουυωωααααααααΑΑΑΑΑΑΑΑηηηηηηηηΗΗΗΗΗΗΗΗωωωωωωωωΩΩΩΩΩΩΩΩαααααααΑΑΑΑΑι¨ηηηηηΕΕΗΗΗ᾿᾿᾿ιιιιιιΙΙΙΙ῾῾῾υυυυρρυυΥΥΥΥΡ¨¨`ωωωωωΟΟΩΩΩ´')), 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǅǇǈǊǋǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǲǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎͰͲͶͿΆΈΉΊΌΎΏΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫϏϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽϾϿЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾸᾹᾺΆᾼῈΈῊΉῌῘῙῚΊῨῩῪΎῬῸΌῺΏῼＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ', 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǆǉǉǌǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏͱͳͷϳάέήίόύώαβγδεζηθικλμνξοπρστυφχψωϊϋϗϙϛϝϟϡϣϥϧϩϫϭϯθϸϲϻͻͼͽѐёђѓєѕіїјљњћќѝўџабвгдежзийклмнопрстуфхцчшщъыьэюяѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӏӂӄӆӈӊӌӎӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱὰάᾳὲέὴήῃῐῑὶίῠῡὺύῥὸόὼώῳａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ'), U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', '                   '),
             '\s+', ' ', 'g'),
           '^[\s.,;:!?¡¿"''«»“”()\[\]]+|[\s.,;:!?¡¿"''«»“”()\[\]]+$', '', 'g');
$$;

-- «12», «-3», «+2», «3,5», «3.5», «−4» → número; cualquier otra cosa → null
create or replace function public._parsear_numero(s text) returns numeric
language plpgsql immutable set search_path = public as $$
declare t text;
begin
  t := replace(regexp_replace(translate(coalesce(s, ''), U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF', '                   '), '^\s+|\s+$', '', 'g'), chr(8722), '-');
  if t !~ '^[+-]?[0-9]+([.,][0-9]+)?$' then return null; end if;
  return replace(t, ',', '.')::numeric;
end $$;

-- ¿Es correcta esta respuesta? `datos` = la pregunta completa; `dada` = lo que contestó
-- (opción múltiple: el índice ORIGINAL de la opción; verdadero/falso: boolean; numérica y corta: el texto).
create or replace function public._corregir_item(datos jsonb, dada jsonb) returns boolean
language plpgsql immutable set search_path = public as $$
declare t text := datos ->> 'tipo'; v numeric; tol numeric; d text;
begin
  if t = 'opcion_multiple' then
    return jsonb_typeof(dada) = 'number' and (dada #>> '{}')::numeric = (datos ->> 'ok')::numeric;
  elsif t = 'verdadero_falso' then
    return jsonb_typeof(dada) = 'boolean' and dada = datos -> 'ok';
  elsif t = 'numerica' then
    if jsonb_typeof(dada) is distinct from 'string' then return false; end if;
    v := public._parsear_numero(dada #>> '{}');
    if v is null then return false; end if;
    tol := coalesce((datos ->> 'tolerancia')::numeric, 0);
    return abs(v - (datos ->> 'valor')::numeric) <= tol + 0.000000001;
  elsif t = 'respuesta_corta' then
    if jsonb_typeof(dada) is distinct from 'string' then return false; end if;
    d := public._normalizar_texto(dada #>> '{}');
    if d = '' then return false; end if;
    return exists (select 1 from jsonb_array_elements_text(datos -> 'aceptadas') a where public._normalizar_texto(a) = d);
  end if;
  return false;
end $$;

-- ---------- Piezas internas ----------------------------------------------

-- Orden en que se enseñan las opciones de una pregunta de opción múltiple (índices originales).
-- Si la pregunta lleva fija_ultima, la última opción se queda al final.
create or replace function public._barajar_opciones(datos jsonb) returns jsonb
language plpgsql volatile set search_path = public as $$
declare n int := jsonb_array_length(datos -> 'ops'); lista int[];
begin
  if datos -> 'fija_ultima' = 'true'::jsonb and n > 1 then
    select array_agg(i order by random()) into lista from generate_series(0, n - 2) i;
    lista := lista || (n - 1);
  else
    select array_agg(i order by random()) into lista from generate_series(0, n - 1) i;
  end if;
  return to_jsonb(lista);
end $$;

-- La pregunta tal como la ve el alumno: SOLO estos campos (lista blanca). Nunca ok, sol, trampa, valor, tolerancia,
-- aceptadas, salida… Las opciones salen ya en su orden barajado: el alumno contesta por POSICIÓN.
create or replace function public._item_alumno(datos jsonb, ops_orden jsonb, clave text) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'clave', clave, 'tipo', datos -> 'tipo', 'enun', datos -> 'enun', 'code', datos -> 'code', 'act', datos -> 'act',
    'categoria', datos -> 'categoria', 'pista', datos -> 'pista', 'unidad', datos -> 'unidad',
    'ops', case when datos ->> 'tipo' = 'opcion_multiple' and ops_orden is not null
                then (select jsonb_agg(datos -> 'ops' -> (v::int) order by o) from jsonb_array_elements_text(ops_orden) with ordinality as t(v, o))
           end));
$$;

-- Cierra una partida y calcula la nota con lo contestado (lo no contestado cuenta como fallo, sin penalización):
--   nota = (aciertos − penalización × fallos) / total × 10, entre 0 y 10
create or replace function public._cerrar_partida(p_id uuid, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare pa public.partidas; pen numeric; tot int; ac int; fa int;
begin
  select * into pa from public.partidas where id = p_id for update;
  if pa.id is null or pa.estado <> 'en_curso' then return; end if;
  select coalesce((j.reglas ->> 'penalizacion')::numeric, 0) into pen
    from public.asignaciones a join public.juegos j on j.id = a.juego where a.id = pa.asignacion;
  tot := jsonb_array_length(pa.seleccion);
  select count(*) filter (where ok), count(*) filter (where not ok) into ac, fa from public.respuestas where partida = p_id;
  update public.partidas
     set estado = p_estado,
         terminada = case when p_estado = 'caducada' then limite else now() end,
         total = tot, aciertos = ac,
         nota = round(greatest(0, (ac - coalesce(pen, 0) * fa)::numeric / greatest(tot, 1) * 10), 2)
   where id = p_id;
end $$;

-- Cierra las partidas cuyo tiempo (más 3 s de cortesía) ya pasó. p_alumno null = las de todos.
create or replace function public._cerrar_caducadas(p_alumno text default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.partidas
            where estado = 'en_curso' and limite + interval '3 seconds' < now() and (p_alumno is null or alumno = p_alumno) loop
    perform public._cerrar_partida(r.id, 'caducada'); n := n + 1;
  end loop;
  return n;
end $$;

-- La partida en marcha, lista para enseñar al alumno (sin soluciones) + lo ya contestado (con su posición)
create or replace function public._salida_partida(p_partida uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ok', true, 'partida', pa.id, 'intento', pa.intento, 'titulo', j.titulo,
    'ahora', now(), 'limite', pa.limite,
    'restante_s', greatest(0, floor(extract(epoch from pa.limite - now()))::int),
    'total', jsonb_array_length(pa.seleccion),
    'items', (select jsonb_agg(public._item_alumno(i.datos, s -> 'ops_orden', s ->> 'clave') order by o)
                from jsonb_array_elements(pa.seleccion) with ordinality as t(s, o)
                join public.items i on i.banco = s ->> 'banco' and i.id = s ->> 'id'),
    'respondidas', coalesce((
      select jsonb_object_agg(r.item,
               case when s -> 'ops_orden' is not null and jsonb_typeof(r.dada) = 'number'
                    then to_jsonb((select (x.o - 1)::int from jsonb_array_elements_text(s -> 'ops_orden') with ordinality as x(v, o)
                                    where x.v::int = (r.dada #>> '{}')::int))
                    else r.dada end)
        from public.respuestas r
        join lateral (select e as s from jsonb_array_elements(pa.seleccion) e where e ->> 'clave' = r.item limit 1) q on true
       where r.partida = pa.id), '{}'::jsonb))
  from public.partidas pa
  join public.asignaciones a on a.id = pa.asignacion
  join public.juegos j on j.id = a.juego
 where pa.id = p_partida;
$$;

-- ---------- Funciones del alumno -------------------------------------------

-- Lo que tiene asignado el grupo del alumno. La nota solo aparece si el profesor la ha publicado.
create or replace function public.mis_juegos(p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  perform public._cerrar_caducadas(a.id);
  return jsonb_build_object('ok', true, 'ahora', now(), 'juegos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'asignacion', asg.id, 'juego', j.id, 'titulo', j.titulo, 'modo', j.modo,
      'preguntas', (j.reglas ->> 'preguntas')::int, 'tiempo_min', (j.reglas ->> 'tiempo_min')::int,
      'desde', asg.desde, 'hasta', asg.hasta, 'intentos', asg.intentos,
      'estado', case when asg.desde is not null and now() < asg.desde then 'pronto'
                     when asg.hasta is not null and now() > asg.hasta then 'cerrado' else 'abierto' end,
      'hechos', (select count(*) from public.partidas p where p.alumno = a.id and p.asignacion = asg.id and p.estado <> 'en_curso'),
      'en_curso', (select p.id from public.partidas p where p.alumno = a.id and p.asignacion = asg.id and p.estado = 'en_curso'),
      'notas_publicadas', asg.notas_publicadas,
      'partidas', coalesce((select jsonb_agg(case when asg.notas_publicadas and p.estado <> 'en_curso'
                                                  then jsonb_build_object('id', p.id, 'intento', p.intento, 'estado', p.estado, 'nota', p.nota)
                                                  else jsonb_build_object('id', p.id, 'intento', p.intento, 'estado', p.estado) end order by p.intento)
                              from public.partidas p where p.alumno = a.id and p.asignacion = asg.id), '[]'::jsonb))
      order by asg.id)
    from public.asignaciones asg join public.juegos j on j.id = asg.juego
    where asg.grupo = a.grupo and j.modo = 'examen'), '[]'::jsonb));
end $$;

-- Empieza un examen (o reanuda el que estaba en marcha). Devuelve las preguntas SIN solución.
create or replace function public.empezar_partida(p_codigo text, p_asignacion bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; asg public.asignaciones; j public.juegos; pa public.partidas;
        hechos int; npreg int; sel jsonb;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  perform pg_advisory_xact_lock(hashtextextended(a.id || ':' || p_asignacion::text, 0));   -- dos llamadas a la vez no crean dos partidas
  perform public._cerrar_caducadas(a.id);

  select * into asg from public.asignaciones where id = p_asignacion and grupo = a.grupo;
  if asg.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  select * into j from public.juegos where id = asg.juego;
  if j.modo <> 'examen' then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;

  select * into pa from public.partidas where alumno = a.id and asignacion = asg.id and estado = 'en_curso';
  if pa.id is not null then return public._salida_partida(pa.id); end if;          -- reanudar

  if asg.desde is not null and now() < asg.desde then return jsonb_build_object('ok', false, 'motivo', 'aun_no', 'desde', asg.desde); end if;
  if asg.hasta is not null and now() > asg.hasta then return jsonb_build_object('ok', false, 'motivo', 'cerrada'); end if;
  select count(*) into hechos from public.partidas where alumno = a.id and asignacion = asg.id;
  if hechos >= asg.intentos then return jsonb_build_object('ok', false, 'motivo', 'sin_intentos'); end if;

  -- Elegir las preguntas: con 'tema', se reparten por temas (la primera de cada tema, luego la segunda…) y se barajan
  npreg := (j.reglas ->> 'preguntas')::int;
  with cand as (
    select i.banco, i.id, i.datos,
           row_number() over (partition by case when j.reglas ->> 'equilibrar' = 'tema' then coalesce(i.tema, '') else '' end order by random()) as rn
      from public.items i where i.banco = any (j.bancos)
  ), elegidas as (
    select * from cand order by rn, random() limit npreg
  )
  select jsonb_agg(jsonb_build_object('banco', banco, 'id', id, 'clave', banco || '/' || id,
                                      'ops_orden', case when datos ->> 'tipo' = 'opcion_multiple' then public._barajar_opciones(datos) end)
                   order by random())
    into sel from elegidas;
  if sel is null or jsonb_array_length(sel) = 0 then return jsonb_build_object('ok', false, 'motivo', 'sin_preguntas'); end if;

  insert into public.partidas(alumno, asignacion, intento, limite, seleccion)
  values (a.id, asg.id, hechos + 1, now() + make_interval(mins => (j.reglas ->> 'tiempo_min')::int), sel)
  returning * into pa;
  return public._salida_partida(pa.id);
end $$;

-- Guarda y corrige una respuesta. No dice si acertó. p_dada: opción múltiple = POSICIÓN (0..n-1) en lo que vio;
-- verdadero/falso = true|false; numérica y corta = el texto. Se puede cambiar hasta entregar.
create or replace function public.responder(p_codigo text, p_partida uuid, p_item text, p_dada jsonb, p_ms int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas; s jsonb; datos jsonb; orig jsonb; n int; pos int; ok boolean;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id for update;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado <> 'en_curso' then return jsonb_build_object('ok', false, 'motivo', pa.estado); end if;
  if now() > pa.limite + interval '3 seconds' then
    perform public._cerrar_partida(pa.id, 'caducada');
    return jsonb_build_object('ok', false, 'motivo', 'caducada');
  end if;

  select e into s from jsonb_array_elements(pa.seleccion) e where e ->> 'clave' = p_item;
  if s is null then return jsonb_build_object('ok', false, 'motivo', 'item'); end if;
  select i.datos into datos from public.items i where i.banco = s ->> 'banco' and i.id = s ->> 'id';

  if datos ->> 'tipo' = 'opcion_multiple' then
    n := jsonb_array_length(datos -> 'ops');
    if jsonb_typeof(p_dada) is distinct from 'number' or (p_dada #>> '{}')::numeric <> trunc((p_dada #>> '{}')::numeric)
       or (p_dada #>> '{}')::numeric < 0 or (p_dada #>> '{}')::numeric >= n then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
    pos := (p_dada #>> '{}')::int;
    orig := s -> 'ops_orden' -> pos;                                  -- de la posición que vio al índice original
  elsif datos ->> 'tipo' = 'verdadero_falso' then
    if jsonb_typeof(p_dada) is distinct from 'boolean' then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
    orig := p_dada;
  else
    if jsonb_typeof(p_dada) is distinct from 'string' or length(p_dada #>> '{}') > 200 then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
    orig := p_dada;
  end if;

  ok := public._corregir_item(datos, orig);
  insert into public.respuestas(partida, item, dada, ok, ms)
  values (pa.id, p_item, orig, ok, case when p_ms between 0 and 3600000 then p_ms end)
  on conflict (partida, item) do update set dada = excluded.dada, ok = excluded.ok, ms = excluded.ms, momento = now();
  return jsonb_build_object('ok', true, 'restante_s', greatest(0, floor(extract(epoch from pa.limite - now()))::int));
end $$;

-- Apunta un suceso del examen (salida de pestaña, vuelta, recarga, corte de red). Máximo 500 por partida.
create or replace function public.evento(p_codigo text, p_partida uuid, p_tipo text, p_detalle jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado <> 'en_curso' then return jsonb_build_object('ok', false, 'motivo', pa.estado); end if;
  if p_tipo is null or p_tipo not in ('salida', 'vuelta', 'recarga', 'sin_red', 'otro') then return jsonb_build_object('ok', false, 'motivo', 'dato'); end if;
  if (select count(*) from public.eventos where partida = pa.id) >= 500 then return jsonb_build_object('ok', true, 'anotado', false); end if;
  insert into public.eventos(partida, tipo, detalle)
  values (pa.id, p_tipo, case when p_detalle is not null and length(p_detalle::text) <= 500 then p_detalle end);
  return jsonb_build_object('ok', true, 'anotado', true);
end $$;

-- Entrega el examen. Calcula la nota, pero NO la enseña: se verá cuando el profesor la publique.
create or replace function public.terminar_partida(p_codigo text, p_partida uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado = 'en_curso' then
    perform public._cerrar_partida(pa.id, case when now() > pa.limite + interval '3 seconds' then 'caducada' else 'entregada' end);
    select * into pa from public.partidas where id = p_partida;
  end if;
  return jsonb_build_object('ok', true, 'estado', pa.estado,
    'publicada', (select asg.notas_publicadas from public.asignaciones asg where asg.id = pa.asignacion));
end $$;

-- El resultado. Mientras el profesor no publique las notas, solo se sabe el estado. Con las notas publicadas:
-- nota, aciertos y total; y, si la asignación lo permite, la revisión pregunta a pregunta con su explicación.
create or replace function public.mi_resultado(p_codigo text, p_partida uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alumnos; pa public.partidas; asg public.asignaciones; res jsonb;
begin
  begin a := public._quien(p_codigo); exception when others then return jsonb_build_object('ok', false, 'motivo', 'espera'); end;
  if a.id is null then return jsonb_build_object('ok', false, 'motivo', 'codigo'); end if;
  select * into pa from public.partidas where id = p_partida and alumno = a.id;
  if pa.id is null then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  if pa.estado = 'en_curso' and now() > pa.limite + interval '3 seconds' then
    perform public._cerrar_partida(pa.id, 'caducada');
    select * into pa from public.partidas where id = p_partida;
  end if;
  select * into asg from public.asignaciones where id = pa.asignacion;
  res := jsonb_build_object('ok', true, 'estado', pa.estado, 'publicada', asg.notas_publicadas, 'terminada', pa.terminada);
  if pa.estado = 'en_curso' then
    return res || jsonb_build_object('restante_s', greatest(0, floor(extract(epoch from pa.limite - now()))::int));
  end if;
  if asg.notas_publicadas then
    res := res || jsonb_build_object('nota', pa.nota, 'aciertos', pa.aciertos, 'total', pa.total);
    if asg.mostrar_soluciones then
      res := res || jsonb_build_object('revision', (
        select jsonb_agg(jsonb_build_object(
                 'clave', s ->> 'clave', 'enun', i.datos -> 'enun', 'ok', coalesce(r.ok, false), 'respondida', r.item is not null,
                 'sol', i.datos -> 'sol', 'trampa', i.datos -> 'trampa',
                 'correcta', case i.datos ->> 'tipo' when 'opcion_multiple' then i.datos -> 'ops' -> ((i.datos ->> 'ok')::int)
                                                     when 'verdadero_falso' then i.datos -> 'ok'
                                                     when 'numerica' then i.datos -> 'valor'
                                                     else i.datos -> 'aceptadas' -> 0 end) order by o)
          from jsonb_array_elements(pa.seleccion) with ordinality as t(s, o)
          join public.items i on i.banco = s ->> 'banco' and i.id = s ->> 'id'
          left join public.respuestas r on r.partida = pa.id and r.item = s ->> 'clave'));
    end if;
  end if;
  return res;
end $$;

-- Del PROFESOR: cierra las partidas cuyo tiempo ya pasó (las que un alumno dejó abandonadas). Devuelve cuántas.
create or replace function public.profe_cerrar_caducadas() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.es_profesor() then raise exception 'no_autorizado'; end if;
  return jsonb_build_object('ok', true, 'cerradas', public._cerrar_caducadas(null));
end $$;

-- ---------- Permisos -------------------------------------------------------
-- Piezas internas: nadie desde fuera. Funciones del alumno: la web pública (con el código). Del profesor: con sesión.

revoke all on function public._normalizar_texto(text)                from public, anon, authenticated;
revoke all on function public._parsear_numero(text)                  from public, anon, authenticated;
revoke all on function public._corregir_item(jsonb, jsonb)           from public, anon, authenticated;
revoke all on function public._barajar_opciones(jsonb)               from public, anon, authenticated;
revoke all on function public._item_alumno(jsonb, jsonb, text)       from public, anon, authenticated;
revoke all on function public._cerrar_partida(uuid, text)            from public, anon, authenticated;
revoke all on function public._cerrar_caducadas(text)                from public, anon, authenticated;
revoke all on function public._salida_partida(uuid)                  from public, anon, authenticated;

revoke all on function public.mis_juegos(text)                       from public;
revoke all on function public.empezar_partida(text, bigint)          from public;
revoke all on function public.responder(text, uuid, text, jsonb, int) from public;
revoke all on function public.evento(text, uuid, text, jsonb)        from public;
revoke all on function public.terminar_partida(text, uuid)           from public;
revoke all on function public.mi_resultado(text, uuid)               from public;
grant execute on function public.mis_juegos(text)                        to anon, authenticated;
grant execute on function public.empezar_partida(text, bigint)           to anon, authenticated;
grant execute on function public.responder(text, uuid, text, jsonb, int) to anon, authenticated;
grant execute on function public.evento(text, uuid, text, jsonb)         to anon, authenticated;
grant execute on function public.terminar_partida(text, uuid)            to anon, authenticated;
grant execute on function public.mi_resultado(text, uuid)                to anon, authenticated;

revoke all on function public.profe_cerrar_caducadas() from public, anon;
grant execute on function public.profe_cerrar_caducadas() to authenticated;

-- Comprobación: debe salir 'memoria ram' y 47.5 (la corrección de textos y números funciona)
select public._normalizar_texto('  Memoria  RAM. ') as texto, public._parsear_numero('47,5') as numero;
