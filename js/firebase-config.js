// Firebase Realtime Database configuration
export const firebaseConfig = {
  apiKey: "AIzaSyAbNJaCAJ6gG77ZAa3e7lHrXUr6KbQ3iSk",
  authDomain: "istservices-39355.firebaseapp.com",
  databaseURL: "https://istservices-39355-default-rtdb.firebaseio.com",
  projectId: "istservices-39355",
  storageBucket: "istservices-39355.firebasestorage.app",
  messagingSenderId: "516839469014",
  appId: "1:516839469014:web:272e433fe9e5ded763be77"
};

// Google Drive configuration (used for admin file uploads/downloads)
// OAuth 2.0 Web Client ID from Google Cloud Console
export const googleDriveConfig = {
  apiKey: "AIzaSyCo5Od1i-6g7gxgrq3yon1clyKU3S2b0lE",
  clientId: "28145377001-u56r51so0lkscglkfodsi83dlo2dlhd5.apps.googleusercontent.com",
  scope: "https://www.googleapis.com/auth/drive.file",
  // Optional: a specific Drive folder ID to upload into. Leave empty
  // to upload to the root of the signed-in admin's My Drive.
  folderId: ""
};

// Secret code that opens the Admin Panel from the search field
export const ADMIN_TRIGGER_CODE = "1006";

// ---------------------------------------------------------------
// Site login — bootstrap seed
// ---------------------------------------------------------------
// Only a salted SHA-256 hash ships in the frontend. The first
// time the app runs with no auth record in Firebase, this hash
// initializes the database. Every subsequent login checks against
// the hash stored in Firebase (see js/auth.js).
export const AUTH_SEED = {
  salt: "e5e283df11e34d05f5854d4a301c5eef",
  hash: "fe76f3734d271ab42dbe4da9662c2728d074367f7e4aae6c8c606f2cfad7373d"
};
