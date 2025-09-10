{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    systems = ["x86_64-linux" "aarch64-linux"];

    mkPackage = pkgs:
      pkgs.buildNpmPackage {
        pname = "atproto-basic-notifications";
        version = "0.1.0";
        src = ./.;
        npmDepsHash = "sha256-gGiNDtxgof7L5y3bH7VWukezEMZbzYkSDdovUwaKQGA=";
        meta.mainProgram = "atproto-basic-notifications";
      };
  in {
    overlays.default = final: prev: {
      atproto-basic-notifications = mkPackage final;
    };

    packages = nixpkgs.lib.genAttrs systems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      default = mkPackage pkgs;
    });

    nixosModules.default = {
      imports = [./module.nix];
      nixpkgs.overlays = [self.overlays.default];
    };
  };
}
