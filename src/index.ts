import { Octokit } from '@octokit/rest';
import { config } from 'dotenv';

import generateBarChart from './generateBarChart.js';
import githubQuery from './githubQuery.js';
import { committedDateQuery, contributedRepoQuery, userInfoQuery } from './queries.js';
/**
 * get environment variable
 */
config({ path: ['.env'] });

interface IRepo {
  name: string;
  owner: string;
}

interface RepoInfo {
  name: string;
  owner: {
    login: string;
  };
  isFork: boolean;
}

interface Edge {
  node: {
    committedDate: string;
    associatedPullRequests?: {
      nodes?: Array<{
        merged?: boolean;
      }>;
    };
  };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface RepoConnection {
  nodes: RepoInfo[];
  pageInfo: PageInfo;
}

interface CommitHistory {
  edges: Edge[];
  pageInfo: PageInfo;
}

(async () => {
  /**
   * First, get user id
   */
  const userResponse = await githubQuery(userInfoQuery).catch((error) =>
    console.error(`Unable to get username and id\n${error}`),
  );
  const { login: username, id } = userResponse?.data?.viewer ?? {};

  /**
   * Second, get contributed repos
   */
  let repoAfter: string | null = null;
  const repos: IRepo[] = [];
  do {
    const repoResponse: any = await githubQuery(contributedRepoQuery, {
      username,
      after: repoAfter,
    }).catch((error) => console.error(`Unable to get the contributed repo\n${error}`));

    if (!repoResponse) return;

    /**
     * If the token is invalid, stop the process
     */
    if (repoResponse.message === 'Bad credentials') {
      console.error('Invalid GitHub token. Please renew the GH_TOKEN');
      return;
    }

    const repoConnection: RepoConnection | undefined = repoResponse?.data?.user?.repositoriesContributedTo;
    if (!repoConnection) break;

    const currentRepos =
      repoConnection?.nodes
        ?.filter((repoInfo: RepoInfo) => !repoInfo?.isFork)
        .map((repoInfo: RepoInfo) => ({
          name: repoInfo?.name,
          owner: repoInfo?.owner?.login,
        })) ?? [];

    repos.push(...currentRepos);
    repoAfter = repoConnection.pageInfo.hasNextPage ? repoConnection.pageInfo.endCursor : null;
  } while (repoAfter);

  /**
   * Third, get commit time and parse into commit-time/hour diagram
   */
  let morning = 0; // 6 - 12
  let daytime = 0; // 12 - 18
  let evening = 0; // 18 - 24
  let night = 0; // 0 - 6

  for (const { name, owner } of repos) {
    let commitAfter: string | null = null;

    do {
      const committedTimeResponse: any = await githubQuery(committedDateQuery, {
        id,
        name,
        owner,
        after: commitAfter,
      }).catch((error) => console.error(`Unable to get the commit info for ${owner}/${name}\n${error}`));
      if (!committedTimeResponse) break;

      const history: CommitHistory | undefined =
        committedTimeResponse?.data?.repository?.defaultBranchRef?.target?.history;
      const edges: Edge[] = history?.edges ?? [];

      edges.forEach((edge: Edge) => {
        const isMergedCommit = edge?.node?.associatedPullRequests?.nodes?.some((pr) => pr?.merged) ?? false;
        if (!isMergedCommit) return;

        const committedDate = edge?.node?.committedDate;
        const timeString = new Date(committedDate).toLocaleTimeString('en-US', {
          hour12: false,
          timeZone: process.env.TIMEZONE,
        });
        const hour = +timeString.split(':')[0];

        /**
         * voting and counting
         */
        if (hour >= 6 && hour < 12) morning++;
        if (hour >= 12 && hour < 18) daytime++;
        if (hour >= 18 && hour < 24) evening++;
        if (hour >= 0 && hour < 6) night++;
      });

      commitAfter = history?.pageInfo?.hasNextPage ? history.pageInfo.endCursor : null;
    } while (commitAfter);
  }

  /**
   * Next, generate diagram
   */
  const sum = morning + daytime + evening + night;
  if (!sum) return;

  const oneDay = [
    { label: '🌞 Morning', commits: morning },
    { label: '🌆 Daytime', commits: daytime },
    { label: '🌃 Evening', commits: evening },
    { label: '🌙 Night', commits: night },
  ];

  const lines = oneDay.reduce((prev, cur) => {
    const percent = (cur.commits / sum) * 100;
    const line = [
      `${cur.label}`.padEnd(10),
      `${cur.commits.toString().padStart(5)} commits`.padEnd(14),
      generateBarChart(percent, 21),
      String(percent.toFixed(1)).padStart(5) + '%',
    ];

    return [...prev, line.join(' ')];
  }, [] as string[]);

  /**
   * Finally, write into gist
   */
  const octokit = new Octokit({ auth: `token ${process.env.GH_TOKEN}` });
  const gist = await octokit.gists
    .get({
      gist_id: `${process.env.GIST_ID}`,
    })
    .catch((error) => console.error(`Unable to update gist\n${error}`));
  if (!gist) return;

  if (!gist.data.files) {
    console.error('No file found in the gist');
    return;
  }

  const filename = Object.keys(gist.data.files)[0];
  await octokit.gists.update({
    gist_id: `${process.env.GIST_ID}`,
    files: {
      [filename]: {
        filename: morning + daytime > evening + night ? "I'm an early 🐤" : "I'm a night 🦉",
        content: lines.join('\n'),
      },
    },
  });

  console.log('Success to update the gist 🎉');
})();
