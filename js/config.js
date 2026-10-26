// Public configuration. The anon key is safe to publish: it can only call the demo_* RPCs
// (see supabase/migrations/20261026000006_demo_api.sql). NEVER put the service-role key here.
export const SUPABASE_URL = 'https://txdubkiyaceyassjcizc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4ZHVia2l5YWNleWFzc2pjaXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5OTM5NDgsImV4cCI6MjEwODU2OTk0OH0.9vrNMG2lW-Ycdd660h9qeNt9aCez8_2Ls70n-n7k8jA';
export const TIMEZONE = 'Asia/Jerusalem';
export const DAYS_AHEAD = 14;
