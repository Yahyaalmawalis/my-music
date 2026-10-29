/* Whisper — backend settings.
   Leave both empty to run in local demo mode (questions stay in each visitor's browser).
   Fill them from Supabase → Project Settings → API (or "Connect"):
     supabaseUrl : the Project URL, e.g. https://abcdefgh.supabase.co
     supabaseKey : the publishable / anon public key (safe to publish; the database rules protect your data).
   Never put the service_role / secret key here. */
window.WHISPER_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
};
