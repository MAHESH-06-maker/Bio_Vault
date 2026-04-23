_:

{
    services.mysql = {
        enable = true;
        initialDatabases = [
            { name = "vault"; }
        ];
        ensureUsers = [
            {
                name = "devenv";
                ensurePermissions = {
                    "*.*" = "ALL PRIVILEGES";
                };
                password = "devenv-password";
            }
        ];
        settings = {
            mysqld.port = 3306;
        };
    };
}
