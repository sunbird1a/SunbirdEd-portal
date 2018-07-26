var fs = require('fs');
var gulp = require('gulp');
var extRef = require('gulp-extract-ref');
var rev = require('gulp-rev')
var collect = require('gulp-rev-collector')
var revdel = require('gulp-rev-del-redundant');
var uglify = require('gulp-uglify');
var runSequence = require('run-sequence');
var htmlclean = require('gulp-htmlclean');
var concat = require('gulp-concat');
var htmlreplace = require('gulp-html-replace');
var imagemin = require('gulp-imagemin');
var textreplace = require('gulp-replace');
var concatCss = require('gulp-concat-css');
var minifyCss = require('gulp-minify-css');
var argv = require('yargs').argv;
var urlPrefixer = require('gulp-url-prefixer');
var async = require("async");
var rmdir = require('rmdir');
var deployAzureCdn = require('gulp-deploy-azure-cdn');
var gutil = require('gulp-util');
var rename = require('gulp-rename');
var htmlstringreplace = require('gulp-string-replace');


//credentials for cdn provider
var cdnServiceCredentials = {
  accountName: argv.accountName,
  accessKey: argv.accessKey,
  cdnServiceProvider: argv.provider || 'azure'
}

var containerName = argv.containerName || 'tenants';
var cdnurl = argv.cdnurl + '/' + containerName;
var particularTenants = argv.tenant || '';

//name if the output folder from which cdn file push done
var distFolderName = 'tenants-build';

var tenantName,sourceTenantFolderPath,distBaseUrl,cdnTargetFolder;
var cloudUrls = {}
var paths = {}

//folder from which files are read and build is prepared
var sourceFolderPath = argv.tenantpath || 'tenant'

if(!argv.accountName || !argv.accessKey){
  console.log("-------- Error -------- Please Provide CDN Provider Credentials")
  return true;
}

if(!argv.cdnurl){
  console.log("-------- Error -------- CDN URL Missing")
  return true;
}

//first step of the build function which loops tenant folder (source) and creates build in series
gulp.task('production', () =>{
  fs.readdir(sourceFolderPath, (err, files) => {

    //check for arguments and run only for those tenants mentioned in the arguments
    if(particularTenants && particularTenants.length){
      files = particularTenants.split(',');
    }

    async.eachSeries(files, function (foldername, next) {
      if(fs.lstatSync(sourceFolderPath + '/' + foldername).isDirectory()){
        recomputeStaticVariables(foldername)
        runSequence('clean','build','revision:rename', 'revision:updateReferences','renameindex','replaceindexText','deletindexfile','upload-app-to-cdn', function(){
          //remove rev-manifest.json after every tenant build which is loacated in respective tenant folder
          fs.unlink(sourceTenantFolderPath + '/rev-manifest.json',function(){
            next()
          })
        }) 
      }else{
        next()
      }
    },function(){
      console.log('all files processing done');
      // rmdir(distFolderName,function(err,done){
      //   console.log("minified folder deleted")
      // });
    });
  })
})

//set all static paths before starting build
function recomputeStaticVariables (foldername) {
  tenantName = foldername;
  sourceTenantFolderPath = sourceFolderPath + '/' + tenantName;
  distBaseUrl = distFolderName + '/' + tenantName
  cdnTargetFolder = cdnurl +  '/' + tenantName;

  cloudUrls = {
    js : cdnTargetFolder + '/script.min.js',
    css : cdnTargetFolder + '/style.min.css',
    images : cdnTargetFolder + '/images',
    fonts : cdnTargetFolder +  '/fonts'
  }

  paths = {
    src: sourceTenantFolderPath + '/**/*',
    srcHTML: sourceTenantFolderPath + '/**/*.html',
    srcCSS: sourceTenantFolderPath + '/**/*.css',
    srcJS: sourceTenantFolderPath + '/**/*.js',

    dist: distBaseUrl,
    distIndex: distBaseUrl + '/index.html',
    distHtml: distBaseUrl + '/**/*.html',
    distCSS: distBaseUrl + '/**/*.css',
    distJS: distBaseUrl + '/**/*.js',
    distAssets : distBaseUrl + '/**/*.{jpg,png,jpeg,gif,svg,eot,ttf,woff,woff2}'
  };
}

// Minify Fonts
gulp.task('fonts', function() {
  return gulp.src([sourceTenantFolderPath + '/fonts/**/*'])
  .pipe(gulp.dest(distBaseUrl + '/fonts/'));
});

// minify image files
gulp.task('images', function () {
  return gulp.src(sourceTenantFolderPath + '/images/**/*')
    .pipe(imagemin())
    .pipe(gulp.dest(distBaseUrl + '/images'))
});

//minify js
gulp.task('js:dist', function() {
  return gulp.src(sourceTenantFolderPath + '/index.html')
    .pipe(extRef({type: 'js',storage:'/'}))
    .pipe(concat('script.min.js'))
    .pipe(uglify())
    .pipe(gulp.dest(paths.dist));
});

//minifycss
gulp.task('css:dist', function() {
  return gulp.src(sourceTenantFolderPath + '/index.html')
    .pipe(extRef({type: 'css',storage:'/'}))
    .pipe(textreplace('../fonts', cloudUrls.fonts))
    .pipe(textreplace('../images', cloudUrls.images))
    .pipe(concatCss('style.min.css',{rebaseUrls:false}))
    .pipe(minifyCss())
    .pipe(gulp.dest(paths.dist));
});

//minify html files
gulp.task('html:dist', function () {
  return gulp.src(paths.srcHTML)
    .pipe(urlPrefixer.html({
      prefix: cdnTargetFolder
    }))
    //inject js and css files into index.html
    .pipe(htmlreplace({
        'css': cloudUrls.css,
        'js': cloudUrls.js
    }))
    .pipe(htmlclean())
    .pipe(gulp.dest(paths.dist));
});

gulp.task('build', ['html:dist','css:dist', 'js:dist','images','fonts']);

gulp.task('clean', function () {
  return rmdir(paths.dist)
});

// file names renaming
gulp.task('revision:rename', () =>{
  return gulp.src([paths.distHtml,paths.distCSS,paths.distJS,paths.distAssets])
  .pipe(rev())
  .pipe(gulp.dest(paths.dist))
  .pipe(rev.manifest('../../' + sourceTenantFolderPath + '/rev-manifest.json'))
  .pipe(revdel('rev-manifest.json',{dest: paths.dist,merge: true}))
  .pipe(gulp.dest(paths.dist)) 
});

//reference changes in all files
gulp.task('revision:updateReferences', () =>{
  var manifest = JSON.parse(fs.readFileSync(sourceTenantFolderPath + '/rev-manifest.json'))
  return gulp.src([sourceTenantFolderPath + '/rev-manifest.json',paths.dist + '/**/*.{html,json,css,js}'])
     .pipe(collect())
     .pipe(gulp.dest(paths.dist))
});

//renaming index.html hashed file to index.html 
gulp.task('renameindex', function() {
    var manifest = JSON.parse(fs.readFileSync(sourceTenantFolderPath + '/rev-manifest.json'))
    // 'dist/*.html'
    return gulp.src( paths.dist + '/' + manifest['index.html'] )
        .pipe(rename('index.html'))
        .pipe(gulp.dest(paths.dist))
});

// delete hashed index.html file
gulp.task('deletindexfile', function() {
  var manifest = JSON.parse(fs.readFileSync(sourceTenantFolderPath + '/rev-manifest.json'))
  return fs.unlink(distFolderName + '/' + tenantName + '/' + manifest['index.html'],function(){
  })
});

gulp.task('replaceindexText', function() {
  var manifest = JSON.parse(fs.readFileSync(sourceTenantFolderPath + '/rev-manifest.json'))
  return gulp.src([paths.distHtml])
    .pipe(htmlstringreplace(manifest['index.html'], 'index.html'))
    .pipe(gulp.dest(paths.dist))
});

//upload to cdn
gulp.task('upload-app-to-cdn', function () {
  if(cdnServiceCredentials.cdnServiceProvider == 'azure'){
    return gulp.src([distFolderName + '/' + tenantName + '/**/*'], {
    }).pipe(deployAzureCdn({
        containerName: containerName, // container name in blob
        serviceOptions: [cdnServiceCredentials.accountName,cdnServiceCredentials.accessKey], // custom arguments to azure.createBlobService
        folder: tenantName, // path within container
        zip: true, // gzip files if they become smaller after zipping, content-encoding header will change if file is zipped
        deleteExistingBlobs: true, // true means recursively deleting anything under folder
        concurrentUploadThreads: 10, // number of concurrent uploads, choose best for your network condition
        metadata: {
            // cacheControl: 'public, max-age=31530000', // cache in browser
            cacheControlHeader: 'public, max-age=31530000' // cache in azure CDN. As this data does not change, we set it to 1 year
        },
        testRun: false // test run - means no blobs will be actually deleted or uploaded, see log messages for details
    })).on('error', function(err){
      console.log("err while uploading files to cdn service ",err)
    });
  }else{
    console.log("CDN Service Provider Not Supported")
  }
});

