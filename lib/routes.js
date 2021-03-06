'use strict';
const
	Hoek = require('hoek'),
	Showdown  = require('showdown'),
	fs = require('fs'),
	url = require('url'),
	path = require('path'),
	forger = require('forger'),
	fsSniff = require('fs-sniff'),
	helpers = require('./helpers'),
	findCategory = helpers.findCategory,
	markdown = new Showdown.Converter({
		tables: true,
		strikethrough: true,
		ghCodeBlocks: true,
		tasklists: true
	});

var
	handlers = {};

module.exports = {
	generate: function generate() {
		let routes = [];

		routes.push({
			method: 'GET',
			path: '/',
			handler: handlers.indexHandler
		});

		routes.push({
			method: 'GET',
			path: '/tag/{tag}',
			handler: handlers.tagHandler
		});

		routes.push({
			method: 'GET',
			path: '/{uri*}',
			handler: handlers.routeHandler
		});

		return routes
	}
};

handlers.indexHandler = function (request, reply) {
	return reply.view('index', request.app.site.context)
};

handlers.tagHandler = function (request, reply) {
	let context = Hoek.clone(request.app.site.context);
	context.articles = helpers.findTagArticles(request.params.tag, context.tags);
	return reply.view('index', context);
};

handlers.routeHandler = function (request, reply) {
	let site = request.app.site;
	let context = Hoek.clone(request.app.site.context);
	let uri = request.params.uri || '';
	let rootPath = site.rootPath;
	let referrer = url.parse(request.info.referrer).pathname;

	let locations = [
		path.join(rootPath, site.files.path, uri),
		path.join(rootPath, site.theme.path, uri),
		path.join(rootPath, site.path, uri)
	];

	if (referrer) {
		// patch: uses referrer to prevent errors for uris with missing trailing fwd. slash
		locations.unshift(path.join(rootPath, site.files.path, referrer, uri));
		// todo: request redirection would be better
		// todo: or not? http://stackoverflow.com/a/5458025/6096446
	}

	function renderMarkdown(filePath) {
		return new Promise((resolve, reject) => {
			fs.readFile(filePath, 'utf8', function (err, data) {
				if (err) {
					console.console.log(err);
					reject(err);
				}
				resolve(markdown.makeHtml(data));
			})
		})
	}

	function renderCategoryOrSeries(uri) {
		return new Promise((resolve, reject) => {
			// render list sub-categories and posts
			try {
				resolve(findCategory(uri, site.context.categories))
			} catch (err) {
				reject(err);
			}
		})
	}

	forger.failover(

		(complete) => {
			// look for a static file
			fsSniff.file(locations, { index: site.files.index }).then((file) => {
				if (request.path.indexOf('.') === -1 && request.path.substr(-1) !== '/') {
					return complete(null);
				}
				if (file.stats.isFile()) {
					reply.file(file.path);
					complete(true);
				}
			}).catch(() => complete(null));
		},

		(complete) => {
			// look for a blog markdown file or a category or series directory
			let articlePath = path.join(rootPath, site.path, uri);
			fsSniff.file(articlePath, { ext: '.md', type: 'any' }).then((file) => {
				if (file.stats.isFile()) {
					renderMarkdown(file.path).then((mdHtml) => {
						let article = {};
						article.text = mdHtml;
						article.meta = helpers.findArticle(uri, site.context.articles);
						context.article = article;
						reply.view('post', context);
						complete(true);
					}).catch((err) => {
						complete(null)
					});
				} else if (file.stats.isDirectory()) {
					renderCategoryOrSeries(uri).then((categoryData) => {
						context.category = categoryData;
						reply.view('category', context);
						complete(true);
					}).catch((err) => complete(null));
				}
			}).catch(() => {
				complete(null)
			});
		},

		(complete) => {
			// look for page markdown files
			let pagePath = path.join(rootPath, site.pages.path, uri);
			fsSniff.file(pagePath, { ext: '.md', type: 'file' }).then((file) => {
				renderMarkdown(file.path).then((mdHtml) => {
					// todo: consider changing post->page in new 'page' layout
					let article = {};
					article.text = mdHtml;
					article.meta = helpers.findArticle(uri, context.articles);
					reply.view('post', { article: article });
					complete(true);
				}).catch(() => complete(null));
			}).catch((err) => complete(null));
		}
	).catch((err) => {
			console.log(new Error('route ' + request.url.pathname + ' couln\'t be resolved'));
			// render 404 if none has been found
			reply('<h1>404</h1><h3>File not found</h3>').code(404);
	})
};
