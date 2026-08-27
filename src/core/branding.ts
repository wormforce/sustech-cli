const ORANGE = "\u001b[38;2;237;108;0m";
const RESET = "\u001b[0m";

const TORCH_ART = String.raw`                :#:   ::####:
            :*##: :#######:
          *##########**##
        ####**********##.
      :##*************#:      ::
     ###**************############
    ###*****************####****##.
    ##***************************#:
   :#***************************##
   .##*************************##:
    ####******######***####***##:
      #########::  #*###=:#*###.
                  ####:#  ###:
                ###      ##:
             :#*
          :                :`;

const WORDMARK_ART = String.raw`          #########:########:
            :#####=:#####:
                 ##:#
           :#:   :#:-   :#-
            ##   :#::   ##
             ##=:####::##
             :####**####:
               :######:`;

export function formatBrandArt(color: boolean): string {
  const art = `${TORCH_ART}\n${WORDMARK_ART}`;
  return color
    ? art.split("\n").map((line) => `${ORANGE}${line}${RESET}`).join("\n")
    : art;
}

export function shouldUseBrandColor(
  isTTY: boolean | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(isTTY && environment.NO_COLOR === undefined && environment.TERM !== "dumb");
}
