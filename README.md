# content-photos

Staging branch for MYO card and recipe photos (Eddy's own, cropped 4:3).
Not part of the website and never merged into main. The `content-image-ingest`
edge function copies files from here into the Supabase `content-images` bucket:

    content-photos/myo/<slug>.jpg      -> content-images/myo/<slug>.jpg
    content-photos/recipes/<slug>.jpg  -> content-images/recipes/<slug>.jpg
