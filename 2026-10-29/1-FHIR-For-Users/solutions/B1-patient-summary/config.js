// App settings. Edit, commit, and GitHub Pages republishes in about a minute.
window.SMART_CONFIG = {
  // Client ID from the Meld registration (launch URI and redirect URI: this folder's URL, trailing / included)
  clientId: 'PUT-YOUR-CLIENT-ID-HERE',
  // Must be a subset of the scopes registered for the client ID. SMART v1 scopes only on Meld.
  scope: 'launch openid fhirUser patient/*.read'
};
