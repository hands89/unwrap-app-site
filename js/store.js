// Store links. Single-button "get the app" links point to the right store for
// the visitor's phone: Google Play on Android, the App Store everywhere else.
// Links marked data-store="ios" or data-store="android" are left alone.
(function () {
  var IOS = "https://apps.apple.com/gb/app/unwrap-app/id6757312100";
  var ANDROID = "https://play.google.com/store/apps/details?id=com.edward.unwrap";
  var isAndroid = /android/i.test(navigator.userAgent || "");

  window.UNWRAP_STORE = { ios: IOS, android: ANDROID, best: isAndroid ? ANDROID : IOS };

  if (!isAndroid) return;
  function retarget(root) {
    var links = (root || document).querySelectorAll('a[href^="' + IOS + '"]:not([data-store])');
    for (var i = 0; i < links.length; i++) links[i].href = ANDROID;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { retarget(); });
  } else {
    retarget();
  }
  window.UNWRAP_STORE.retarget = retarget;
})();
