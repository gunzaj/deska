/**
 * "Tasks only" mode: the user skipped the GitHub setup and uses Deska for
 * personal tasks. With no GitHub token there is no token owner, so the app's
 * one local user is this stand-in. It is never sent to GitHub.
 */
export const LOCAL_LOGIN = "local";
