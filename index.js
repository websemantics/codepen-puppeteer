/**
 * @copyright (c) 2016-2017, Web Semantics, Inc.
 * @author Adnan M.Sagar, PhD. <adnan@websemantics.ca>
 * @license Distributed under the terms of the MIT License.
 */

const puppeteer = require('puppeteer')
const querystring = require('querystring')
const fs = require('fs')

/**
 * Download Codepen pages
 * 
 * @param {String} searchQuery - search query
 * @param {Array} links - list or urls to download (used in `file` and `debug` commands)
 * @param {String} pensPath - folder to store downloaded pens
 * @param {String} debugPath - folder to store screenshots
 * @param {String} penTemplate - pen html template (find @ `./assets/templates/pen.html`)
 * @param {String} indexTemplate - index page html template (find @ `./assets/templates/index.html`)
 * @private
 */
module.exports = async function run({searchQuery = '', links = null, pensPath = 'pens/', debug = false, 
                                          debugPath = 'debug/', startPage = 1, endPage = 4,
                                          penTemplate = 'assets/templates/pen.html', 
                                          indexTemplate = 'assets/templates/index.html'}) {

  /* Read template files */
  penTemplate = fs.readFileSync(penTemplate, {encoding: 'utf8'})
  indexTemplate = fs.readFileSync(indexTemplate, {encoding: 'utf8'})

  /* Ensure folders exist */
  if (!fs.existsSync(pensPath)) { fs.mkdirSync(pensPath) }
  if (!fs.existsSync(debugPath) && debug) { fs.mkdirSync(debugPath) }
  
  var browser = await puppeteer.launch({
    headless: !debug,
    ignoreHTTPSErrors: true
  })
  var page = await browser.newPage()
  var searchUrl = 'https://codepen.io/search/pens'
  var params = {limit: 'all', q: searchQuery}
  var pens = []

  if (debug) {
    await page.setViewport({width: 1400, height: 800})
  }

  if(!links){
    /* (1) Request result page from `startPage` to `endPage` */
    for (params.page = startPage; params.page <= endPage; params.page++) {
      
      /* (2) Get pens urls from search page (unless in debug mode) */
      log('Search for "' + params.q + '", PAGE #' + params.page)

      await page.goto(searchUrl + '/?' + querystring.stringify(params), {
        waitUntil: 'load'
      })

      links = await page.evaluate(() => {
        var list = document.querySelectorAll('.meta > .item-title > a')
        var links = []

        for (var element of list) {
          links.push({
            title: element.innerHTML,
            url: element.getAttribute('href')
          })
        }

        return links
      })
      
      /* (3) Request individual pens */
      await download(links, pens, page, penTemplate, pensPath, debug, debugPath)

      /* (4) Finally, save an index.html page with the list of downloaded pens (so far) */
      saveIndex(pens, pensPath, indexTemplate)
    }
  } else {
      /* (5) If direct links are provided, download and save index file */
      await download(links, pens, page, penTemplate, pensPath, debug, debugPath)
      saveIndex(pens, pensPath, indexTemplate)
  }

  browser.close()
}


/**
 * Save index page
 * 
 * @param {Object} page - 
 */
function saveIndex(pens, pensPath, indexTemplate){
  var list = ''
  
    for (var pen of pens) {
      var title = pen.title.trim()
      list +=
        '<a href="' +
        titleToFilename(title) +
        '.html" target="iframe">' +
        title +
        '</a>'
    }

    fs.writeFileSync(
      pensPath + 'index.html',
      indexTemplate.replace('{{list}}', list)
    )
}

/**
 * Download a list of pens
 * 
 * @param {Object} page - 
 */
async function download(links, pens, page, penTemplate, pensPath, debug, debugPath) {
  for (var pen of links) {
    var filename = titleToFilename(pen.title) + '.html'

    /* (3.a) Add link to pens collection */
    pens.push(pen)

    /* (3.b) Skip download if pen already exists  */
    if (fs.existsSync(pensPath + filename)) {
      log('Pen "' + pensPath + filename + '" already saved!')
      continue
    }

    log('Processing "' + pen.title.trim() + '" @ ' + pen.url)
    
    await page.goto(pen.url, {waitUntil: 'networkidle'})
    
    if (debug) {
      /* save page before assets are compiled */
      await page.screenshot({path: debugPath + 'before.png', fullPage: true})
    }

    /* (3.c) Wait until the iframe is loded */
    await page.waitForSelector('.result-iframe[src^="https"]')
    
    /* (3.d) Click Code Box dropdown then complie link (html, css and javascript ) */
    await page.click('#box-html .editor-actions-right > button')
    await page.click('#html-view-compiled')

    await page.click('#box-css .editor-actions-right > button')
    await page.click('#css-view-compiled')

    await page.click('#box-js .editor-actions-right > button')
    await page.click('#js-view-compiled')

    /* (3.e) Get content from CodeMirror */
    var content = await page.evaluate(() => {
      var list = document.querySelectorAll('.code-wrap .CodeMirror')
      var content = []

      for (var editor of list) {
        content.push(editor.CodeMirror.getValue())
      }

      return content
    })

    /* (3.f) Get external resources  */
    var resources = await page.evaluate(() => {
      var jsSelector = document.querySelectorAll('#js-external-resources input.external-resource.tt-input')
      var cssSelector = document.querySelectorAll('#css-external-resources input.external-resource.tt-input')
      var resources = {
        javascript: [],
        css: []
      }

      for (var input of jsSelector) {
        var val = input.value.trim()
        if (val) {
          resources.javascript.push(val)
        }
      }

      for (var input of cssSelector) {
        var val = input.value.trim()
        if (val) {
          resources.css.push(val)
        }
      }
      
      return resources
    })

    if (debug) {
      /* save page after assets are compiled to detect any issues */
      await page.screenshot({path: debugPath + 'after.png', fullPage: true})
    }

    /* (3.g) Construct an html page from the pen template */
    var html = penTemplate
      .replace('{{html}}', content[0] ? content[0] : '')
      .replace('{{title}}', pen.title.trim())
      .replace('{{url}}', pen.url)
      .replace('{{style}}', content[1] ? content[1] : '')
      .replace('{{javascript}}', content[2] ? content[2] : '')
      .replace('{{resources.javascript}}', resources.javascript.map(src => {
        return '<script src="' + src + '"></script>'
      }).join('\n'))
      .replace('{{resources.style}}', resources.css.map(href => {
        return '<link rel="stylesheet" href="' + href + '">'
      }).join('\n'))

    fs.writeFileSync(pensPath + filename, html)
    log('... saved to "' + pensPath + filename + '"')
  }

return pens
}

/**
 * Clean text to be used as filename
 * 
 * @param {String} string - page title
 * @private
 */
function titleToFilename(string) {
  return string
    .trim()
    .replace(/[^a-z0-9]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/-$|^-/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Log to console
 * 
 * @param {String} string - output string
 * @private
 */
function log(string) {
  console.log(string)
}
