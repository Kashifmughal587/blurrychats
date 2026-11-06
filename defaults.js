// Single source of truth for settings. Loaded by the popup, the content script and the background worker.
var BC_DEFAULTS = {
  enabled: true,        // master switch
  messages: true,       // chat messages
  preview: true,        // last-message line in chat list
  media: true,          // photos / videos / link-preview pictures
  gallery: true,        // full-screen viewer
  input: true,          // typing box
  pics: true,           // profile pictures, status rings, community icons
  names: true,          // chat names + group sender names
  amount: 7,            // blur strength in px
  instant: true,        // no fade animation
  peek: false,          // show everything while mouse is on the page
  idle: true,           // blur everything after inactivity
  idleSeconds: 30,
  leave: false,         // blur everything when this window loses focus
  pauseMinutes: 1,      // "show everything for N minutes" length
  safeChats: []         // chat names that are never blurred
};
