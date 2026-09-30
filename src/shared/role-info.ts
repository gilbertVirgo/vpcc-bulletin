/** What each role involves, by role id. Copied from the old bulletin's getAllRoleInfo. */
// ponytail: edited in code, not the app; move onto rota_roles with an editor if it starts changing often.
export type RoleInfo = { arrival?: string; how: string[] };

export const ROLE_INFO: Record<string, RoleInfo> = {
  lyrics: {
    arrival: "2:00 PM",
    how: [
      "Ask whoever's on worship what songs they're doing",
      "Add the songs via prismic.io (ask Gil for help if needed)",
      "Upon arrival at the building, set up the projector and laptop (ask Gil for help if needed)",
      "Ensure that the lyrics are displaying properly on the projector screen",
      "After church: pack everything down and leave it as you found it",
    ],
  },
  "sunday-lunch": {
    how: [
      "Find a recipe which doesn't contain dairy, nuts, milk, wheat, gluten, barley or meat",
      "Buy the ingredients (a budget of £30 is available if needed — just remember to hold on to your receipts)",
      "Cook the food in time for eating at 1pm",
    ],
  },
  "lunch-cleanup": {
    how: [
      "After lunch is finished, organise tidy-up roles for everyone who's not leaving to set up at church",
      "Verify that the dining room and kitchen are clean before leaving for church",
    ],
  },
  soundcheck: {
    arrival: "2:15 PM",
    how: [
      "Turn on the mixing desk",
      "Turn on both speakers",
      "Help the musicians plug instruments and microphones in",
      "Taking note of the channels, mix the band",
      "After church: turn off the speakers first, then the mixing desk, then help the musicians pack down the music gear",
    ],
  },
  worship: {
    arrival: "2:00 PM",
    how: [
      "Set up microphones and instruments",
      "Do the soundcheck with whoever is on 'Soundcheck'",
      "After church: clear away the instruments, microphones, stands and cables so that they are left as they were found",
    ],
  },
  "worship-support": {
    arrival: "2:00 PM",
    how: [
      "Arrive with whoever is on 'Worship'",
      "Help set up microphones and instruments",
      "Do the soundcheck with whoever is on 'Soundcheck'",
      "After church: help clear away the instruments, microphones, stands and cables so that they are left as they were found",
    ],
  },
  refreshments: {
    arrival: "2:45 PM",
    how: [
      "Prepare coffee, tea and either mugs or cups",
      "Optionally, provide snacks. A budget of up to £10/term is available if needed — just remember to hold on to your receipts",
    ],
  },
  welcome: {
    arrival: "2:45 PM",
    how: [
      "Starting from the chairs at the front, set out Bibles, clipboards and pencils",
      "Put ‘Welcome’ A-frame sign outside the front of the building facing the right way round",
      "When a guest arrives, if they’re new, take them through to the refreshments table",
    ],
  },
  preaching: { arrival: "3:00 PM", how: ["Preach the gospel"] },
  "communion-prep": {
    arrival: "3:00 PM",
    how: [
      "Verify that there is gluten-free bread, wine and non-alcoholic wine available",
      "If any of these are missing or out of date, go buy some fresh stock. Recommended: 'Whole Foods E3' on Roman Road",
      "Set out the bread and wine on a table to the left of the pulpit with some napkins",
      "After church: clear up the bread and wine and leave everything else as you found it",
    ],
  },
  creche: {
    arrival: "3:00 PM",
    how: [
      "Ideally, try to sit with Phoebe through the service in a non-distracting place. If she's too fidgety, take her to the play-corner",
      "After the service is finished, tidy up the play-area and return any toys which have been removed",
    ],
  },
};
