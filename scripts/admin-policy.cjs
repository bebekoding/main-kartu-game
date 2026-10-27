/* The allowlist is provisioned with project-owner tooling after checking the
 * reserved account in Firebase Authentication, never from a writable profile.
 */
module.exports = function installAdminPolicy(document) {
  const admin = "(auth != null && auth.token.firebase.sign_in_provider === 'password' && auth.uid === root.child('config/adminUid').val() && auth.token.email === '__admin__@mainkartu.local' && root.child('config/adminAuthAfter').isNumber() && auth.token.auth_time >= root.child('config/adminAuthAfter').val())";
  function replace(node) {
    for (const [key,value] of Object.entries(node)) {
      if (typeof value === 'string') {
        node[key] = value.replaceAll("root.child('adminSessions').child(auth.uid).exists()", admin);
      } else if (value && typeof value === 'object') replace(value);
    }
  }
  replace(document);
  // Old hashes and sessions are inert. Even a matching hash cannot mint a role.
  document.rules.adminSessions = {'.read':false, '.write':false};
  document.rules.config.adminUid = {'.read':admin, '.write':false};
  document.rules.config.adminAuthAfter = {'.read':false, '.write':false};
};
