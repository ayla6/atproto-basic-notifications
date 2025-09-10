# copied from here https://github.com/NixOS/nixpkgs/blob/nixos-unstable/nixos/modules/services/web-apps/bluesky-pds.nix
{
  lib,
  pkgs,
  config,
  ...
}: let
  cfg = config.services.atproto-basic-notifications;

  inherit
    (lib)
    getExe
    mkEnableOption
    mkIf
    mkOption
    mkPackageOption
    types
    ;
in {
  options.services.atproto-basic-notifications = {
    enable = mkEnableOption "basic notification system for atproto stuff";

    package = mkPackageOption pkgs "atproto-basic-notifications" {};

    settings = mkOption {
      type = types.submodule {
        freeformType = types.attrsOf (
          types.oneOf [
            (types.nullOr types.str)
            types.port
          ]
        );
        options = {
          TARGET_DID = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "The DID of the user to monitor, put yours otherwise you'll be getting all my notifs lol.";
            example = "did:plc:3c6vkaq7xf5kz3va3muptjh5";
          };

          JETSTREAM_URL = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "The URL of the jetstream to connect to.";
            example = "wss://jetstream2.us-east.bsky.network/subscribe";
          };

          NTFY_URL = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "The URL of the ntfy.sh server for sending notifications, you should definitely change this. If you have a login put this on the environment file thing not here!!!";
            example = "http://ntfy.sh";
          };

          BSKY_URL = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "The URL of the Bluesky web client, probably doesn't make sense editing.";
            example = "https://bsky.app";
          };

          PDSLS_URL = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "The URL for pdsls.dev, probably doesn't make sense editing.";
            example = "https://pdsls.dev";
          };

          TANGLED_URL = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "The URL for tangled.sh, probably doesn't make sense editing.";
            example = "https://tangled.sh";
          };
        };
      };

      description = ''
        Environment variables to set for the service. Secrets should be
        specified using {option}`environmentFile`.

        Refer to <https://github.com/ayla6/atproto-basic-notifications/blob/main/index.ts> for available environment variables.
      '';
    };

    environmentFiles = mkOption {
      type = types.listOf types.path;
      default = [];
      description = "this is where you should put the ntfy url if there's a login or token";
    };
  };

  config = mkIf cfg.enable {
    systemd.services.atproto-basic-notifications = {
      description = "basic notification system for atproto stuff";

      after = ["network-online.target"];
      wants = ["network-online.target"];
      wantedBy = ["multi-user.target"];

      serviceConfig = {
        ExecStart = getExe cfg.package;
        Environment =
          lib.mapAttrsToList (k: v: "${k}=${
            if builtins.isInt v
            then toString v
            else v
          }") (
            lib.filterAttrs (_: v: v != null) cfg.settings
          );

        EnvironmentFile = cfg.environmentFiles;
        User = "atp-notif";
        Group = "atp-notif";
        StateDirectory = "atproto-basic-notifications";
        StateDirectoryMode = "0755";
        Restart = "always";

        # Hardening
        RemoveIPC = true;
        CapabilityBoundingSet = ["CAP_NET_BIND_SERVICE"];
        NoNewPrivileges = true;
        PrivateDevices = true;
        ProtectClock = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectKernelModules = true;
        PrivateMounts = true;
        SystemCallArchitectures = ["native"];
        MemoryDenyWriteExecute = false; # required by V8 JIT
        RestrictNamespaces = true;
        RestrictSUIDSGID = true;
        ProtectHostname = true;
        LockPersonality = true;
        ProtectKernelTunables = true;
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];
        RestrictRealtime = true;
        DeviceAllow = [""];
        ProtectSystem = "strict";
        ProtectProc = "invisible";
        ProcSubset = "pid";
        ProtectHome = true;
        PrivateUsers = true;
        PrivateTmp = true;
        UMask = "0077";
      };
    };

    users = {
      users.atp-notif = {
        group = "atp-notif";
        isSystemUser = true;
      };
      groups.atp-notif = {};
    };
  };
}
