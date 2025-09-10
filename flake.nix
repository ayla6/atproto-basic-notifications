{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    pkgs = nixpkgs.legacyPackages."x86_64-linux";
  in {
    packages."x86_64-linux".default = pkgs.buildNpmPackage {
      pname = "atproto-basic-notifications";
      version = "0.1.0";
      src = ./.;
      npmDepsHash = "sha256-gGiNDtxgof7L5y3bH7VWukezEMZbzYkSDdovUwaKQGA=";
    };
  };
}
