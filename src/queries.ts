export const userInfoQuery = `
  query {
    viewer {
      login
      id
    }
  }
`;

export const contributedRepoQuery = `
  query ($username: String!, $after: String) {
    user(login: $username) {
      repositoriesContributedTo(first: 100, after: $after, includeUserRepositories: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          isFork
          name
          owner {
            login
          }
        }
      }
    }
  }
`;

export const committedDateQuery = `
  query ($id: ID!, $name: String!, $owner: String!, $after: String) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 100, after: $after, author: { id: $id }) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  committedDate
                  associatedPullRequests(first: 1) {
                    nodes {
                      merged
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
