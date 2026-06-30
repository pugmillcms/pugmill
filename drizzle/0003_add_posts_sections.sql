-- Section-composed pages: optional section stack on posts/pages.
-- null = render the single Markdown `content` body (default).
-- IF NOT EXISTS keeps this safe if an environment already added the column via push.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "sections" jsonb;
