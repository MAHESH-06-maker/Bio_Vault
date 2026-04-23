{
    inputs = {
        flake-utils.url = "github:numtide/flake-utils";
        nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    };

    outputs = { nixpkgs, flake-utils, ... }:
        flake-utils.lib.eachDefaultSystem (system:
            let
                pkgs = import nixpkgs { inherit system; };
            in
            {
                devShell = pkgs.mkShell {
                    packages = with pkgs; [
                        mariadb.client
                        python314
                        python314Packages.asyncmy
                        python314Packages.fastapi
                        python314Packages.httpx
                        python314Packages.jwcrypto
                        python314Packages.pytest
                        python314Packages.cryptography
                        python314Packages.pydantic
                        python314Packages.python-multipart
                        python314Packages.sqlalchemy
                        python314Packages.sqlmodel
                        python314Packages.uvicorn
                    ];
                };
            }
        );
}
