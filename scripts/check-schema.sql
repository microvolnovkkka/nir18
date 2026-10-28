-- Проверка в одной транзакции: тестовые строки всегда откатываются.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    author uuid := '00000000-0000-4000-8000-000000000001';
    other_author uuid := '00000000-0000-4000-8000-000000000002';
    article uuid := gen_random_uuid();
    image_id uuid := gen_random_uuid();
BEGIN
    IF (SELECT count(*) FROM users) <> 5 OR (SELECT count(*) FROM users WHERE is_active OR password_hash IS NOT NULL) <> 0 THEN
        RAISE EXCEPTION 'Expected five inactive accounts without passwords on foundation';
    END IF;
    IF (SELECT count(*) FROM directions) <> 5 OR (SELECT count(*) FROM subtopics) <> 15 THEN
        RAISE EXCEPTION 'Catalog seed mismatch';
    END IF;
    INSERT INTO publications(id,author_id,subtopic_id,title,markdown,revision_key)
        VALUES(article,author,101,'Проверка MediaPipe','Русский текст FER',gen_random_uuid());
    BEGIN
        UPDATE publications SET markdown=' ' WHERE id=article;
        RAISE EXCEPTION 'Empty markdown was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE publications SET subtopic_id=32000 WHERE id=article;
        RAISE EXCEPTION 'Missing subtopic was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    INSERT INTO media(id,owner_id,storage_key,original_name,mime_type,byte_size,width,height,sha256,state,lease_until)
        VALUES(image_id,other_author,image_id::text||'.png','test.png','image/png',1,1,1,decode(repeat('00',32),'hex'),'ready',now()+interval '24 hours');
    BEGIN
        INSERT INTO publication_media VALUES(article,image_id,author);
        RAISE EXCEPTION 'Foreign media ownership was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        UPDATE media SET width=20000001 WHERE id=image_id;
        RAISE EXCEPTION 'Pixel limit was not enforced';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE media SET owner_id=author WHERE id=image_id;
    INSERT INTO publication_media VALUES(article,image_id,author);
    DELETE FROM publications WHERE id=article;
    IF EXISTS(SELECT 1 FROM publication_media WHERE publication_id=article) OR NOT EXISTS(SELECT 1 FROM media WHERE id=image_id) THEN
        RAISE EXCEPTION 'Delete should remove links, not physical-media metadata';
    END IF;
END $$;
ROLLBACK;
SELECT 'schema checks passed; test data rolled back' AS result;
