'use strict';

const assert = require('chai').assert;
const mockery = require('mockery');
const sinon = require('sinon');

const testPayloadClose = require('./data/github.pull_request.closed.json');
const testPayloadOpen = require('./data/github.pull_request.opened.json');
const testPayloadPush = require('./data/github.push.json');
const testPayloadSync = require('./data/github.pull_request.synchronize.json');

sinon.assert.expose(assert, { prefix: '' });

describe('index', () => {
    let GithubScm;
    let scm;
    let githubMock;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        githubMock = {
            authenticate: sinon.stub(),
            repos: {
                createStatus: sinon.stub(),
                get: sinon.stub(),
                getBranch: sinon.stub(),
                getById: sinon.stub(),
                getCommit: sinon.stub(),
                getContent: sinon.stub()
            },
            users: {
                getForUser: sinon.stub()
            }
        };

        mockery.registerMock('github', sinon.stub().returns(githubMock));

        /* eslint-disable global-require */
        GithubScm = require('../index');
        /* eslint-enable global-require */

        scm = new GithubScm({
            retry: {
                minTimeout: 10
            }
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('extends base class', () => {
        assert.isFunction(scm.formatScmUrl);
        assert.isFunction(scm.getPermissions);
        assert.isFunction(scm.getCommitSha);
        assert.isFunction(scm.updateCommitStatus);
    });

    describe('formatScmUrl', () => {
        it('adds master when there is no branch', () => {
            const scmUrl = 'git@github.com:screwdriver-cd/scm-github.git';
            const expectedScmUrl = 'git@github.com:screwdriver-cd/scm-github.git#master';

            assert.strictEqual(scm.formatScmUrl(scmUrl), expectedScmUrl);
        });

        it('lowercases scmUrl and adds master when there is no branch', () => {
            const scmUrl = 'git@github.com:Screwdriver-cd/scm-github.git';
            const expectedScmUrl = 'git@github.com:screwdriver-cd/scm-github.git#master';

            assert.strictEqual(scm.formatScmUrl(scmUrl), expectedScmUrl);
        });

        it('lowercases scmUrl and uses the branch without changing', () => {
            const scmUrl = 'git@github.com:Screwdriver-cd/scm-github.git#Test';
            const expectedScmUrl = 'git@github.com:screwdriver-cd/scm-github.git#Test';

            assert.strictEqual(scm.formatScmUrl(scmUrl), expectedScmUrl);
        });

        it('scm url does not match regex', () => {
            const scmUrl = 'foo';

            assert.throws(() => scm.formatScmUrl(scmUrl), 'Invalid scmUrl: foo');
        });
    });

    describe('getCommitSha', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/models.git#master';
        const branch = {
            commit: {
                sha: '1234567'
            }
        };
        const config = {
            scmUrl,
            token: 'somerandomtoken'
        };

        it('promises to get the commit sha', () => {
            githubMock.repos.getBranch.yieldsAsync(null, branch);

            return scm.getCommitSha(config)
            .catch(() => {
                assert.fail('This should not fail the test');
            })
            .then((data) => {
                assert.calledWith(githubMock.repos.getBranch, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    host: 'github.com',
                    branch: 'master'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(data, branch.commit.sha);
            });
        });

        it('fails when github fails', () => {
            const error = new Error('githubBreaking');

            githubMock.repos.getBranch.yieldsAsync(error);

            return scm.getCommitSha(config)
            .then(() => {
                assert.fail('This should not fail the test');
            })
            .catch((err) => {
                assert.calledWith(githubMock.repos.getBranch, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    host: 'github.com',
                    branch: 'master'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(err, error);
            });
        });
    });

    describe('getPermissions', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/models.git';
        const repo = {
            permissions: {
                admin: true,
                push: false,
                pull: false
            }
        };
        const config = {
            scmUrl,
            token: 'somerandomtoken'
        };

        it('promises to get permissions', () => {
            githubMock.repos.get.yieldsAsync(null, repo);

            return scm.getPermissions(config)
            .then((data) => {
                assert.calledWith(githubMock.repos.get, {
                    user: 'screwdriver-cd',
                    repo: 'models'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(data, repo.permissions);
            })
            .catch(() => {
                assert.fail('This should not fail the test');
            });
        });

        it('returns an error when github command fails', () => {
            const err = new Error('githubError');

            githubMock.repos.get.yieldsAsync(err);

            return scm.getPermissions(config)
            .then(() => {
                assert.fail('This should not fail the test');
            })
            .catch((error) => {
                assert.calledWith(githubMock.repos.get, {
                    user: 'screwdriver-cd',
                    repo: 'models'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(error, err);
            });
        });
    });

    describe('updateCommitStatus', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/models.git';
        const data = {
            permissions: {
                admin: true,
                push: false,
                pull: false
            }
        };
        let configSuccess;
        const configFailure = {
            scmUrl,
            sha: 'ccc49349d3cffbd12ea9e3d41521480b4aa5de5f',
            buildStatus: 'FAILURE',
            token: 'somerandomtoken'
        };

        beforeEach(() => {
            configSuccess = {
                scmUrl,
                sha: 'ccc49349d3cffbd12ea9e3d41521480b4aa5de5f',
                buildStatus: 'SUCCESS',
                token: 'somerandomtoken'
            };
        });

        it('promises to update commit status on success', () => {
            githubMock.repos.createStatus.yieldsAsync(null, data);

            return scm.updateCommitStatus(configSuccess)
            .then((result) => {
                assert.calledWith(githubMock.repos.createStatus, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    sha: configSuccess.sha,
                    state: 'success',
                    description: 'Everything looks good!',
                    context: 'Screwdriver'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: configSuccess.token
                });

                assert.deepEqual(result, data);
            })
            .catch(() => {
                assert.fail('This should not fail the test');
            });
        });

        it('sets a target_url when id passed in', () => {
            githubMock.repos.createStatus.yieldsAsync(null, data);
            configSuccess.url = 'http://localhost/v3/builds/1234/logs';

            return scm.updateCommitStatus(configSuccess)
                .then((result) => {
                    assert.calledWith(githubMock.repos.createStatus, {
                        user: 'screwdriver-cd',
                        repo: 'models',
                        sha: configSuccess.sha,
                        state: 'success',
                        description: 'Everything looks good!',
                        context: 'Screwdriver',
                        target_url: 'http://localhost/v3/builds/1234/logs'
                    });

                    assert.calledWith(githubMock.authenticate, {
                        type: 'oauth',
                        token: configSuccess.token
                    });

                    assert.deepEqual(result, data);
                })
                .catch((err) => {
                    assert.fail(err, 'This should not fail the test');
                });
        });

        it('sets a better context when jobName passed in', () => {
            githubMock.repos.createStatus.yieldsAsync(null, data);
            configSuccess.jobName = 'PR-15';

            return scm.updateCommitStatus(configSuccess)
                .then((result) => {
                    assert.calledWith(githubMock.repos.createStatus, {
                        user: 'screwdriver-cd',
                        repo: 'models',
                        sha: configSuccess.sha,
                        state: 'success',
                        description: 'Everything looks good!',
                        context: 'Screwdriver/PR-15'
                    });

                    assert.calledWith(githubMock.authenticate, {
                        type: 'oauth',
                        token: configSuccess.token
                    });

                    assert.deepEqual(result, data);
                })
                .catch((err) => {
                    assert.fail(err, 'This should not fail the test');
                });
        });

        it('promises to update commit status on failure', () => {
            githubMock.repos.createStatus.yieldsAsync(null, data);

            return scm.updateCommitStatus(configFailure)
            .catch(() => {
                assert.fail('This should not fail the test');
            })
            .then((result) => {
                assert.calledWith(githubMock.repos.createStatus, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    sha: configFailure.sha,
                    state: 'failure',
                    description: 'Did not work as expected.',
                    context: 'Screwdriver'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: configFailure.token
                });

                assert.deepEqual(result, data);
            });
        });

        it('returns an error when github command fails', () => {
            const err = new Error('githubError');

            githubMock.repos.createStatus.yieldsAsync(err);

            return scm.updateCommitStatus(configSuccess)
            .then(() => {
                assert.fail('This should not fail the test');
            })
            .catch((error) => {
                assert.calledWith(githubMock.repos.createStatus, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    sha: configSuccess.sha,
                    state: 'success',
                    description: 'Everything looks good!',
                    context: 'Screwdriver'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: configSuccess.token
                });

                assert.deepEqual(error, err);
            });
        });
    });

    describe('stats', () => {
        let configSuccess;

        beforeEach(() => {
            configSuccess = {
                scmUrl: 'git@github.com:screwdriver-cd/models.git',
                sha: 'ccc49349d3cffbd12ea9e3d41521480b4aa5de5f',
                buildStatus: 'SUCCESS',
                token: 'somerandomtoken'
            };
        });

        it('returns the correct stats', () => {
            githubMock.repos.createStatus.yieldsAsync(null, {});

            return scm.updateCommitStatus(configSuccess)
            .catch(() => {
                assert.fail('This should not fail the test');
            })
            .then(() => {
                // Because averageTime isn't deterministic on how long it will take,
                // will need to check each value separately.
                const stats = scm.stats();

                assert.strictEqual(stats.requests.total, 1);
                assert.strictEqual(stats.requests.timeouts, 0);
                assert.strictEqual(stats.requests.success, 1);
                assert.strictEqual(stats.requests.failure, 0);
                assert.strictEqual(stats.breaker.isClosed, true);
            });
        });
    });

    describe('getFile', () => {
        const scmUrl = 'git@github.com:screwdriver-cd/models.git';
        const content = `IyB3b3JrZmxvdzoKIyAgICAgLSBwdWJsaXNoCgpqb2JzOgogICAgbWFpbjoK\n
ICAgICAgICBpbWFnZTogbm9kZTo2CiAgICAgICAgc3RlcHM6CiAgICAgICAg\n
ICAgIC0gaW5zdGFsbDogbnBtIGluc3RhbGwKICAgICAgICAgICAgLSB0ZXN0\n
OiBucG0gdGVzdAoKICAgICMgcHVibGlzaDoKICAgICMgICAgIHN0ZXBzOgog\n
ICAgIyAgICAgICAgIGNvbmZpZ3VyZTogLi9zY3JpcHRzL2NvbmZpZ3VyZQog\n
ICAgIyAgICAgICAgIGluc3RhbGw6IG5wbSBpbnN0YWxsCiAgICAjICAgICAg\n
ICAgYnVtcDogbnBtIHJ1biBidW1wCiAgICAjICAgICAgICAgcHVibGlzaDog\n
bnBtIHB1Ymxpc2ggJiYgZ2l0IHB1c2ggb3JpZ2luIC0tdGFncyAtcQo=\n'`;
        const returnData = {
            type: 'file',
            content,
            encoding: 'base64'
        };
        const returnInvalidData = {
            type: 'notFile'
        };
        const expectedYaml = `# workflow:
#     - publish

jobs:
    main:
        image: node:6
        steps:
            - install: npm install
            - test: npm test

    # publish:
    #     steps:
    #         configure: ./scripts/configure
    #         install: npm install
    #         bump: npm run bump
    #         publish: npm publish && git push origin --tags -q
`;
        const config = {
            scmUrl,
            path: 'screwdriver.yaml',
            token: 'somerandomtoken',
            ref: '46f1a0bd5592a2f9244ca321b129902a06b53e03'
        };

        const configNoRef = {
            scmUrl,
            path: 'screwdriver.yaml',
            token: 'somerandomtoken'
        };

        it('promises to get content when a ref is passed', () => {
            githubMock.repos.getContent.yieldsAsync(null, returnData);

            return scm.getFile(config)
            .catch(() => {
                assert.fail('This should not fail the test');
            })
            .then((data) => {
                assert.calledWith(githubMock.repos.getContent, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    path: config.path,
                    ref: config.ref
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(data, expectedYaml);
            });
        });

        it('promises to get content when a ref is not passed', () => {
            githubMock.repos.getContent.yieldsAsync(null, returnData);

            return scm.getFile(configNoRef)
            .catch(() => {
                assert.fail('This should not fail the test');
            })
            .then((data) => {
                assert.calledWith(githubMock.repos.getContent, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    path: configNoRef.path,
                    ref: 'master'
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(data, expectedYaml);
            });
        });

        it('returns error when path is not a file', () => {
            githubMock.repos.getContent.yieldsAsync(null, returnInvalidData);

            return scm.getFile(config)
            .then(() => {
                assert.fail('This should not fail the test');
            })
            .catch((err) => {
                assert.calledWith(githubMock.repos.getContent, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    path: config.path,
                    ref: config.ref
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.strictEqual(err.message, 'Path (screwdriver.yaml) does not point to file');
            });
        });

        it('returns an error when github command fails', () => {
            const err = new Error('githubError');

            githubMock.repos.getContent.yieldsAsync(err);

            return scm.getFile(config)
            .then(() => {
                assert.fail('This should not fail the test');
            })
            .catch((error) => {
                assert.calledWith(githubMock.repos.getContent, {
                    user: 'screwdriver-cd',
                    repo: 'models',
                    path: config.path,
                    ref: config.ref
                });

                assert.calledWith(githubMock.authenticate, {
                    type: 'oauth',
                    token: config.token
                });

                assert.deepEqual(error, err);
            });
        });
    });

    describe('getRepoId', () => {
        const scmUrl = 'git@github.com:foo/bar.git#test';
        const expectedRepoId = {
            id: 'github.com:123456:test',
            name: 'foo/bar',
            url: 'https://github.com/foo/bar/tree/test'
        };
        const repoData = {
            id: 123456,
            full_name: 'foo/bar'
        };
        const branchData = {
            // eslint-disable-next-line no-underscore-dangle
            _links: {
                html: 'https://github.com/foo/bar/tree/test'
            }
        };
        const invalidData = {
            error: true
        };
        const config = {
            scmUrl,
            token: 'somerandomtoken'
        };

        it('returns the correct repoId', () => {
            githubMock.repos.get.yieldsAsync(null, repoData);
            githubMock.repos.getBranch.yieldsAsync(null, branchData);

            return scm.getRepoId(config)
            .catch(() => {
                assert.fail('This should not fail the test');
            })
            .then((repoId) => {
                assert.deepEqual(repoId, expectedRepoId);
            });
        });

        it('returns an error when github get command fails', () => {
            const err = new Error('githubError');

            githubMock.repos.get.yieldsAsync(err, invalidData);
            githubMock.repos.getBranch.yieldsAsync(err, branchData);

            return scm.getRepoId(config)
            .catch((error) => {
                assert.deepEqual(error, err);
            });
        });

        it('returns an error when github getBranch command fails', () => {
            const err = new Error('githubError');

            githubMock.repos.get.yieldsAsync(null, repoData);
            githubMock.repos.getBranch.yieldsAsync(err, invalidData);

            return scm.getRepoId(config)
            .catch((error) => {
                assert.deepEqual(error, err);
            });
        });
    });

    describe('decorateAuthor', () => {
        const username = 'notmrkent';

        it('decorates a github user', () => {
            githubMock.users.getForUser.yieldsAsync(null, {
                login: username,
                id: 2042,
                avatar_url: 'https://avatars.githubusercontent.com/u/2042?v=3',
                html_url: `https://github.com/${username}`,
                name: 'Klark Cent'
            });

            // eslint-disable-next-line no-underscore-dangle
            return scm._decorateAuthor({
                token: 'tokenfordecorateauthor',
                username
            }).then((data) => {
                assert.deepEqual(data, {
                    avatar: 'https://avatars.githubusercontent.com/u/2042?v=3',
                    name: 'Klark Cent',
                    url: `https://github.com/${username}`,
                    username
                });

                assert.calledWith(githubMock.users.getForUser, {
                    user: username
                });
            });
        });

        it('rejects when failing to communicate with github', () => {
            const testError = new Error('someGithubCommError');

            githubMock.users.getForUser.yieldsAsync(testError);

            // eslint-disable-next-line no-underscore-dangle
            return scm._decorateAuthor({
                token: 'randomtoken',
                username
            }).then(() => {
                assert.fail('This should not fail the test');
            }, (err) => {
                assert.deepEqual(err, testError);

                assert.calledWith(githubMock.users.getForUser, {
                    user: username
                });
            });
        });
    });

    describe('decorateCommit', () => {
        const scmUri = 'github.com:089253:yummy';
        const sha = '26516f13718705497086a00929eedf45eb729fe6';

        beforeEach(() => {
            githubMock.repos.getById.yieldsAsync(null, {
                full_name: 'banana/peel'
            });
        });

        it('decorates a commit', () => {
            githubMock.repos.getCommit.yieldsAsync(null, {
                commit: {
                    author: {
                        name: 'Batman Wayne'
                    },
                    message: 'some commit message that is here'
                },
                author: {
                    login: 'notbrucewayne',
                    id: 1234567,
                    avatar_url: 'https://avatars.githubusercontent.com/u/1234567?v=3',
                    html_url: 'https://github.com/notbrucewayne',
                    type: 'User',
                    site_admin: false
                }
            });

            // eslint-disable-next-line no-underscore-dangle
            return scm._decorateCommit({
                scmUri,
                sha,
                token: 'tokenfordecoratecommit'
            }).then((data) => {
                assert.deepEqual(data, {
                    author: {
                        avatar: 'https://avatars.githubusercontent.com/u/1234567?v=3',
                        name: 'Batman Wayne',
                        url: 'https://github.com/notbrucewayne',
                        username: 'notbrucewayne'
                    },
                    message: 'some commit message that is here',
                    url: `https://github.com/banana/peel/tree/${sha}`
                });

                assert.calledWith(githubMock.repos.getCommit, {
                    owner: 'banana',
                    repo: 'peel',
                    sha
                });
            });
        });

        it('rejects when failing to communicate with github', () => {
            const testError = new Error('theErrIexpect');

            githubMock.repos.getCommit.yieldsAsync(testError);

            // eslint-disable-next-line no-underscore-dangle
            return scm._decorateCommit({
                scmUri,
                sha,
                token: 'tokenforfailingtodecorate'
            }).then(() => {
                assert.fail('This should not fail the test');
            }, (err) => {
                assert.deepEqual(err, testError);

                assert.calledWith(githubMock.repos.getCommit, {
                    owner: 'banana',
                    repo: 'peel',
                    sha
                });
            });
        });
    });

    describe('decorateUrl', () => {
        it('decorates a scm uri', () => {
            const scmUri = 'github.com:102498:boat';

            githubMock.repos.getById.yieldsAsync(null, {
                full_name: 'iAm/theCaptain'
            });

            // eslint-disable-next-line no-underscore-dangle
            return scm._decorateUrl({
                scmUri,
                token: 'mytokenfortesting'
            }).then((data) => {
                assert.deepEqual(data, {
                    branch: 'boat',
                    name: 'iAm/theCaptain',
                    url: 'https://github.com/iAm/theCaptain/tree/boat'
                });

                assert.calledWith(githubMock.repos.getById, {
                    id: '102498'
                });
            });
        });

        it('rejects when github lookup fails', () => {
            const scmUri = 'github.com:102498:boat';
            const testError = new Error('decorateUrlError');

            githubMock.repos.getById.yieldsAsync(testError);

            // eslint-disable-next-line no-underscore-dangle
            return scm._decorateUrl({
                scmUri,
                token: 'mytokenfortesting'
            }).then(() => {
                assert.fail('This should not fail the test');
            }, (err) => {
                assert.deepEqual(err, testError);

                assert.calledWith(githubMock.repos.getById, {
                    id: '102498'
                });
            });
        });
    });

    describe('parseHook', () => {
        const commonPullRequestParse = {
            branch: 'master',
            checkoutUrl: 'git@github.com:baxterthehacker/public-repo.git',
            prNum: 1,
            prRef: 'git@github.com:baxterthehacker/public-repo.git#pull/1/merge',
            sha: '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c',
            type: 'pr',
            username: 'baxterthehacker'
        };
        let payloadChecker;
        let testHeaders;

        beforeEach(() => {
            testHeaders = {
                'x-github-event': null
            };

            payloadChecker = sinon.stub();
        });

        it('parses a payload for a push event payload', () => {
            testHeaders['x-github-event'] = 'push';

            return scm.parseHook(testHeaders, testPayloadPush)
            .then((result) => {
                assert.deepEqual(result, {
                    action: 'push',
                    branch: 'master',
                    checkoutUrl: 'git@github.com:baxterthehacker/public-repo.git',
                    sha: '0d1a26e67d8f5eaf1f6ba5c57fc3c7d91ac0fd1c',
                    type: 'repo',
                    username: 'baxterthehacker'
                });
            });
        });

        it('parses a payload for a pull request event payload', () => {
            testHeaders['x-github-event'] = 'pull_request';

            return scm.parseHook(testHeaders, testPayloadOpen)
            .then((result) => {
                payloadChecker(result);

                assert.calledWith(payloadChecker, sinon.match(commonPullRequestParse));
                assert.calledWith(payloadChecker, sinon.match({ action: 'opened' }));
            });
        });

        it('parses a payload for a pull request being closed', () => {
            testHeaders['x-github-event'] = 'pull_request';

            return scm.parseHook(testHeaders, testPayloadClose)
            .then((result) => {
                payloadChecker(result);
                assert.calledWith(payloadChecker, sinon.match(commonPullRequestParse));
                assert.calledWith(payloadChecker, sinon.match({ action: 'closed' }));
            });
        });

        it('parses a payload for a pull request being synchronized', () => {
            testHeaders['x-github-event'] = 'pull_request';

            return scm.parseHook(testHeaders, testPayloadSync)
            .then((result) => {
                payloadChecker(result);
                assert.calledWith(payloadChecker, sinon.match(commonPullRequestParse));
                assert.calledWith(payloadChecker, sinon.match({ action: 'synchronized' }));
            });
        });

        it('throws an error when parsing an unsupported payload', () => {
            testHeaders['x-github-event'] = 'other_event';

            return scm.parseHook(testHeaders, testPayloadPush)
            .then(() => {
                assert.fail('This should not fail the tests');
            }, (err) => {
                assert.match(err.message, /Event other_event not supported/);
            });
        });
    });

    describe('parseUrl', () => {
        const repoData = {
            id: 8675309,
            full_name: 'iAm/theCaptain'
        };
        const token = 'mygithubapitoken';
        const repoInfo = {
            host: 'github.com',
            repo: 'theCaptain',
            user: 'iAm'
        };

        it('parses a complete ssh url', () => {
            const checkoutUrl = 'git@github.com:iAm/theCaptain.git#boat';

            githubMock.repos.get.yieldsAsync(null, repoData);

            return scm.parseUrl({
                checkoutUrl,
                token
            }).then((result) => {
                assert.strictEqual(result, 'github.com:8675309:boat');

                assert.calledWith(githubMock.repos.get, sinon.match(repoInfo));
                assert.calledWith(githubMock.repos.get, sinon.match({ branch: 'boat' }));
            });
        });

        it('parses a ssh url, defaulting the branch to master', () => {
            const checkoutUrl = 'git@github.com:iAm/theCaptain.git';

            githubMock.repos.get.yieldsAsync(null, repoData);

            return scm.parseUrl({
                checkoutUrl,
                token
            }).then((result) => {
                assert.strictEqual(result, 'github.com:8675309:master');

                assert.calledWith(githubMock.repos.get, sinon.match(repoInfo));
                assert.calledWith(githubMock.repos.get, sinon.match({ branch: 'master' }));
            });
        });
    });
});
