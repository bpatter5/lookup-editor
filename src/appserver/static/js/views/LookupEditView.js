
require.config({
    paths: {
    	handsontable: "../app/lookup_editor/js/lib/handsontable.full.min",
        text: "../app/lookup_editor/js/lib/text",
        console: '../app/lookup_editor/js/lib/console',
        csv: '../app/lookup_editor/js/lib/csv',
        kv_store_field_editor: '../app/lookup_editor/js/views/KVStoreFieldEditor',
        clippy: '../app/lookup_editor/js/lib/clippy',
    },
    shim: {
        'handsontable': {
        	deps: ['jquery'],
            exports: 'Handsontable'
        },
        'clippy': {
            deps: ['jquery'],
            exports: 'clippy'
        }
    }
});

define([
    "underscore",
    "backbone",
    "models/SplunkDBase",
    "collections/SplunkDsBase",
    "splunkjs/mvc",
    "util/splunkd_utils",
    "jquery",
    "handsontable",
    "splunkjs/mvc/simplesplunkview",
    "splunkjs/mvc/simpleform/input/text",
    "splunkjs/mvc/simpleform/input/dropdown",
    "splunkjs/mvc/simpleform/input/checkboxgroup",
    "text!../app/lookup_editor/js/templates/LookupEdit.html",
    "kv_store_field_editor",
    "clippy",
    "csv",
    "bootstrap.dropdown",
    "splunk.util",
    "css!../app/lookup_editor/css/LookupEdit.css",
    "css!../app/lookup_editor/css/lib/handsontable.full.min.css",
    "css!../app/lookup_editor/css/lib/clippy.css",
], function(
    _,
    Backbone,
    SplunkDBaseModel,
    SplunkDsBaseCollection,
    mvc,
    splunkd_utils,
    $,
    Handsontable,
    SimpleSplunkView,
    TextInput,
    DropdownInput,
    CheckboxGroupInput,
    Template,
    KVStoreFieldEditor
){
	
	var Apps = SplunkDsBaseCollection.extend({
	    url: "apps/local?count=-1&search=disabled%3D0",
	    initialize: function() {
	      SplunkDsBaseCollection.prototype.initialize.apply(this, arguments);
	    }
	});
	
	var KVLookup = SplunkDBaseModel.extend({
	    initialize: function() {
	    	SplunkDBaseModel.prototype.initialize.apply(this, arguments);
	    }
	});
	
	var Backup = Backbone.Model.extend();
	
	var Backups = Backbone.Collection.extend({
	    url: Splunk.util.make_full_url("/custom/lookup_editor/lookup_edit/get_lookup_backups_list"),
	    model: Backup
	});
	
	
    // Define the custom view class
    var LookupEditView = SimpleSplunkView.extend({
        className: "LookupEditView",
        
        defaults: {
        	
        },
        
        /**
         * Initialize the class.
         */
        initialize: function() {
        	this.options = _.extend({}, this.defaults, this.options);
        	
            this.backups = null;
            
            // The information for the loaded lookup
            this.lookup = null;
            this.namespace = null;
            this.owner = null;
            this.lookup_type = null;
            this.lookup_config = null;
            
            this.field_types = {}; // This will store the expected types for each field
            this.field_types_enforced = false; // This will store whether this lookup enforces types
            this.read_only = false; // We will update this to true if the lookup cannot be edited
            this.table_header = null; // This will store the header of the table so that can recall the relative offset of the fields in the table
            
            this.users = null; // This is where loaded users list will be stored
            this.agent = null; // This is for Clippy
            
            this.kv_store_fields_editor = null;
            
            // These are copies of editor classes used with the handsontable
            this.forgiving_checkbox_editor = null;
            this.time_editor = null;
            
            this.handsontable = null; // A reference to the handsontable
            this.columns = null; // This will store meta-data about the columns
            
        	// Get the apps
        	this.apps = new Apps();
        	this.apps.on('reset', this.gotApps.bind(this), this);
        	
        	this.apps.fetch({
                success: function() {
                  console.info("Successfully retrieved the list of applications");
                },
                error: function() {
                  console.error("Unable to fetch the apps");
                }
            });
        	
        	this.is_new = true;
        	
        	this.info_message_posted_time = null;
        	
        	setInterval(this.hideInfoMessageIfNecessary.bind(this), 1000);
        	
        	// Listen to changes in the KV field editor so that the validation can be refreshed
        	this.listenTo(Backbone, "kv_field:changed", this.validateForm.bind(this));
        },
        
        events: {
        	// Filtering
        	"click #save"               : "doSaveLookup",
        	"click .backup-version"     : "doLoadBackup",
        	"click .user-context"       : "doLoadUserContext",
        	"click #export-file"        : "doExport",
        	"click #choose-import-file" : "chooseImportFile",
        	"click #import-file"        : "openFileImportModal",
        	"change #import-file-input" : "importFile",
        	"dragenter #lookup-table"   : "onDragFileEnter",
        	"dragleave #lookup-table"   : "onDragFileEnd"
        },
        
        /**
         * Hide the informational message if it is old enough
         */
        hideInfoMessageIfNecessary: function(){
        	if(this.info_message_posted_time && ((this.info_message_posted_time + 5000) < new Date().getTime() )){
        		this.info_message_posted_time = null;
        		$("#info-message", this.$el).fadeOut(200);
        	}
        },
        
        /**
         * For some reason the backbone handlers don't work.
         */
        setupDragDropHandlers: function(){
        	
        	// Setup a handler for handling files dropped on the table
        	var drop_zone = document.getElementById('lookup-table');
        	this.setupDragDropHandlerOnElement(drop_zone);
        	
        	// Setup a handler for handling files dropped on the import dialog
        	drop_zone2 = document.getElementById('import-file-modal');
        	this.setupDragDropHandlerOnElement(drop_zone2);
        	
        },
        
        setupDragDropHandlerOnElement: function(drop_zone){
        	
        	drop_zone.ondragover = function (e) {
        		e.preventDefault();
        		e.dataTransfer.dropEffect = 'copy';
        	}.bind(this);
        	
        	drop_zone.ondrop = function (e) {
        	      e.preventDefault();
        	      this.onDropFile(e);
        	      return false;
        	}.bind(this);
        },
        
        /**
         * Get the field name for the column.
         */
        getFieldForColumn: function(col){
        	
        	var row_header = this.getTableHeader();
        	
        	return row_header[col];
        },
        
        /**
         * Get the table header.
         */
        getTableHeader: function(use_cached){
        	
        	// Assign a default argument to use_cached
        	if(typeof use_cached === 'undefined'){
        		use_cached = true;
        	}
        	
        	// Use the cache if available
        	if(use_cached && this.table_header !== null){
        		return this.table_header;
        	}
        	
        	// If the lookup is a CSV, then the first row is the header
        	if(this.lookup_type === "csv"){
        		this.table_header = this.handsontable.getDataAtRow(0);
        	}
        	// If the lookup is a KV store lookup, then ask handsontable for the header
        	else{
        		this.table_header = this.handsontable.getColHeader();
        	}
        	
        	return this.table_header;
        },
        
        /**
         * Get the column that has a given field name.
         */
        getColumnForField: function(field_name){
        	
        	var row_header = this.getTableHeader();
        	
        	for(var c = 0; c < row_header.length; c++){
        		if(row_header[c] === field_name){
        			return c;
        		}
        	}
        	
        	console.warn('Unable to find the field with the name "' + field_name + '"')
        	return null;
        },
        
        /**
         * Determine if the cell type is invalid for KV cells that have enforced data-types.
         */
        isCellTypeInvalid: function(row, col, value){
        	
        	// Stop if type enforcement is off
        	if(!this.field_types_enforced){
        		return false;
        	}
        	
        	// Determine the type of the field
        	var field_type = this.getFieldType(col);
        	
        	// Check it if it is an number
        	if(field_type === 'number' && !/^[-]?\d+$/.test(value)){
    			return true;
    		}
    		
    		// Check it if it is an boolean
    		else if(field_type === 'boolean' && !/^(true)|(false)$/.test(value)){
    			return true;
    		}
        	
        	return false;
        },
        
        /**
         * Get the type associated with the given field.
         */
        getFieldType: function(column){
        	
        	// Stop if we didn't get the types necessary
        	if(!this.field_types){
        		return null;
        	}
        	
        	var table_header = this.getTableHeader();
        	
        	// Stop if we didn't get the header
        	if(!table_header){
        		return null;
        	}
        	
        	if(column < this.table_header.length){
        		return this.field_types[table_header[column]];
        	}
        	
        	// Return null if we didn't find the entry
        	return null;
        	
        },
        
        /**
         * Cell renderer for HandsOnTable
         */
        lookupRenderer: function(instance, td, row, col, prop, value, cellProperties) {
        	
        	// Don't render a null value
        	if(value === null){
        		td.innerHTML = this.escapeHtml("");
        	}
        	else{
        		td.innerHTML = this.escapeHtml(value);
        	}
        	
        	// Determine if the value is a string so that we can know if we can perform string-related operations on it later
        	var is_a_string = false;
        	
        	if(value){
        		is_a_string = (typeof value.toLowerCase === 'function');
        	}
        	
        	// Execute the renderer
        	if(row !== 0 && this.isCellTypeInvalid(row, col, value)) { // Cell type is incorrect
        		td.className = 'cellInvalidType';
        	}
        	else if(!value || value === '') {
        		td.className = 'cellEmpty';
        	}
        	else if(this.getFieldForColumn(col) === "_key"){
        		td.className = 'cellKey';
        	}
        	else if (parseFloat(value) < 0) { //if row contains negative number
        		td.className = 'cellNegative';
        	}
        	else if( String(value).substring(0, 7) == "http://" || String(value).substring(0, 8) == "https://"){
        		td.className = 'cellHREF';
        	}
        	else if (parseFloat(value) > 0) { //if row contains positive number
        		td.className = 'cellPositive';
        	}
        	else if(row === 0 && this.lookup_type === 'csv') {
        		td.className = 'cellHeader';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'true') {
        		td.className = 'cellTrue';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() ==='false') {
        		td.className = 'cellFalse';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'unknown') {
        		td.className = 'cellUrgencyUnknown';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'informational') {
        		td.className = 'cellUrgencyInformational';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'low') {
        		td.className = 'cellUrgencyLow';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'medium') {
        		td.className = 'cellUrgencyMedium';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'high') {
        		td.className = 'cellUrgencyHigh';
        	}
        	else if(value !== null && is_a_string && value.toLowerCase() === 'critical') {
        		td.className = 'cellUrgencyCritical';
        	}
        	else {
        		td.className = '';
        	}
        	
        	if(cellProperties.readOnly) {
        	    td.style.opacity = 0.7;
        	}
        	
        },
        
        /**
         * Open the modal for importing a file.
         */
        openFileImportModal: function(){
        	
        	$('.dragging').removeClass('dragging');
        	
        	$('#import-file-modal', this.$el).modal();
        	
        	// Setuo handlers for drag & drop
        	$('.modal-backdrop').on('dragenter', function(){
        		$('.modal-body').addClass('dragging');
        		console.log("enter");
        	});
        	
        	$('.modal-backdrop').on('dragleave', function(){
        		$('.modal-body').removeClass('dragging');
        		console.log("leave");
        	});
        	
        	$('#import-file-modal').on('dragenter', function(){
        		$('.modal-body').addClass('dragging');
        		console.log("enter");
        	});
        	
        	/*
        	$('#import-file-modal').on('dragleave', function(){
        		$('.modal-body').removeClass('dragging');
        		console.log("leave");
        	});
        	*/
        },
        
        /**
         * Open the file dialog to select a file to import.
         */
        chooseImportFile: function(){
        	$("#import-file-input").click();
        },
        
        /**
         * Load the selected lookup from the history.
         * 
         * @param version The version of the lookup file to load (a value of null will load the latest version)
         */
        loadBackupFile: function(version){
        	
        	// Load a default for the version
        	if( typeof version == 'undefined' ){
        		version = null;
        	}
        	
        	var r = confirm('This version the lookup file will now be loaded.\n\nUnsaved changes will be overridden.');
        	
        	if (r == true) {
        		this.loadLookupContents(this.lookup, this.namespace, this.owner, this.lookup_type, false, version);
        		return true;
        	}
        	else{
        		return false;
        	}
        },
        
        /**
         * Load the selected lookup from the given user's context.
         * 
         * @param user The user context from which to load the lookup
         */
        loadUserKVEntries: function(user){
        	
        	// Stop if user wasn't provided
        	if( typeof user == 'undefined' ){
        		return;
        	}
        	
        	this.loadLookupContents(this.lookup, this.namespace, user, this.lookup_type, false);
        	
        	// Make a dict with arguments
        	var d = {
        		'owner' : user,
        		'namespace' : this.namespace,
        		'type' : this.lookup_type,
        		'lookup' : this.lookup,
        	};
        	
        	history.pushState(d, "Lookup Edit", "?" + $.param(d, true));
        },
        
        /**
         * Hide the warning message.
         */
        hideWarningMessage: function(){
        	this.hide($("#warning-message", this.$el));
        },
        
        /**
         * Hide the informational message
         */
        hideInfoMessage: function(){
        	this.hide($("#info-message", this.$el));
        },
        
        /**
         * Hide the messages.
         */
        hideMessages: function(){
        	this.hideWarningMessage();
        	this.hideInfoMessage();
        },
        
        /**
         * Show a warning noting that something bad happened.
         */
        showWarningMessage: function(message){
        	$("#warning-message > .message", this.$el).text(message);
        	this.unhide($("#warning-message", this.$el));
        },
        
        /**
         * Show a warning noting that something bad happened.
         */
        showInfoMessage: function(message){
        	$("#info-message > .message", this.$el).text(message);
        	this.unhide($("#info-message", this.$el));
        	
        	this.info_message_posted_time = new Date().getTime();
        },
        
        /**
         * Load the list of backup lookup files.
         * 
         * @param lookup_file The name of the lookup file
         * @param namespace The app where the lookup file exists
         * @param user The user that owns the file (in the case of user-based lookups)
         */
        loadLookupBackupsList: function(lookup_file, namespace, user){
        	
        	var data = {"lookup_file":lookup_file,
                	    "namespace":namespace};
    	
        	
        	// Populate the default parameter in case user wasn't provided
        	if( typeof user === 'undefined' ){
        		user = null;
        	}

        	// If a user was defined, then pass the name as a parameter
        	if(user !== null){
        		data["owner"] = user;
        	}
        	
        	// Fetch them
        	this.backups = new Backups();
        	this.backups.fetch({
        		data: $.param(data),
        		success: this.renderBackupsList.bind(this)
        	});
        	
        },
        
        onDragFile: function(evt){
        	evt.stopPropagation();
            evt.preventDefault();
            evt.dataTransfer.dropEffect = 'copy'; // Make it clear this is a copy
        },
        
        onDragFileEnter: function(evt){
        	evt.preventDefault();
        	//$('#drop-zone', this.$el).show();
        	//$('#drop-zone', this.$el).height($('#lookup-table', this.$el).height());
        	//$('#lookup-table', this.$el).addClass('drop-target');
        	return false;
        },
        
        onDragFileEnd: function(){
        	console.log("Dragging stopped");
        	this.$el.removeClass('dragging');
        },
        
        /**
         * Import the dropped file.
         */
        onDropFile: function(evt){
        	
        	console.log("Got a file via drag and drop");
        	evt.stopPropagation();
            evt.preventDefault();
            var files = evt.dataTransfer.files;
            
            this.importFile(evt);
        },
        
	     /* 
	      * Use the browser's built-in functionality to quickly and safely escape a string of HTML.
	      */
	     escapeHtml: function(str) {
	         var div = document.createElement('div');
	         div.appendChild(document.createTextNode(str));
	         return div.innerHTML;
	     },
        
        /**
         * Import the given file into the lookup.
         */
        importFile: function(evt){
        	
        	// Stop if this is a KV collection; importing isn't yet supported
        	if(this.lookup_type !== "csv"){
        		this.showWarningMessage("Drag & drop importing on KV store lookups is not currently supported");
        		console.info("Drag and dropping on a KV store lookup being ignored");
        		return false;
        	}
        	
        	// Stop if this is read-only
        	if(this.read_only){
        		console.info("Drag and dropping on a read-only lookup being ignored");
        		return false;
        	}
        	
        	// Stop if the browser doesn't support processing files in Javascript
        	if(!window.FileReader){
        		alert("Your browser doesn't support file reading in Javascript; thus, I cannot parse your uploaded file");
        		return false;
        	}
        	
        	// Get a reader so that we can read in the file
        	var reader = new FileReader();
        	
        	// Setup an onload handler that will process the file
        	reader.onload = function(evt) {
        		
        		console.log("Running file reader onload handler");
        		
        		// Stop if the ready state isn't "loaded"
                if(evt.target.readyState != 2){
                	return;
                }
                
                // Stop if the file could not be processed
                if(evt.target.error) {
                	
                	// Hide the loading message
                	$(".table-loading-message").hide();
                	
                	// Show an error
                    this.showWarningMessage("Unable to import the file");
                    return;
                }
                
                // Get the file contents
                var filecontent = evt.target.result;
                
                // Import the file into the view
            	var data = new CSV(filecontent, { }).parse();
            	
            	// Render the lookup file
            	this.renderLookup(data);
            	
            	// Hide the import dialog
            	$('#import-file-modal', this.$el).modal('hide');
            	
            	// Show a message noting that the file was imported
            	this.showInfoMessage("File imported successfully");
            	
        	}.bind(this);
        	
        	var files = [];
        	
        	// Get the files from the file input widget if available
        	if(evt.target.files && evt.target.files.length > 0){
        		files = evt.target.files;
        	}
        	
        	// Get the files from the drag & drop if available
        	else if(evt.dataTransfer && evt.dataTransfer.files.length > 0){
        		files = evt.dataTransfer.files;
        	}
        	
            // Stop if no files where provided (user likely pressed cancel)
            if(files.length > 0 ){
        	    
        	    // Set the file name if this is a new file and a filename was not set yet
        	    if(this.is_new && (!mvc.Components.getInstance("lookup-name").val() || mvc.Components.getInstance("lookup-name").val().length <= 0)){
        	    	mvc.Components.getInstance("lookup-name").val(files[0].name);
        	    }
        	    
        	    // Start the process of processing file
        	    reader.readAsText(files[0]);
        	    
            	if(this.agent){
            		this.agent.play("Thinking");
            	}
            }
            else{
            	// Hide the loading message
            	$(".table-loading-message").hide();
            }
        	
        },
        
        /**
         * Render the list of backup files.
         */
        renderBackupsList: function(){
        	
        	var backup_list_template = ' \
        		<% for(var c = 0; c < backups.length; c++){ %> \
        			<li><a class="backup-version" href="#" data-backup-time="<%- backups[c].time %>"><%- backups[c].time_readable %></a></li> \
        		<% } %> \
        		<% if(backups.length == 0){ %> \
        			<li><a class="backup-version" href="#">No backup versions available</a></li> \
        		<% } %>';
        	
        	// Render the list of backups
        	$('#backup-versions', this.$el).html(_.template(backup_list_template, {
        		'backups' : this.backups.toJSON()
        	}));
        	
        	// Show the list of backup lookups
        	if(this.read_only !== true){
        		$('#load-backup', this.$el).show();
        	}
        	else{
        		$('#load-backup', this.$el).hide();
        	}
        	
        },
        
        /**
         * Make a new KV store lookup
         */
        makeKVStoreLookup: function(namespace, lookup_file, owner){
        	
        	// Set a default value for the owner
        	if( typeof owner == 'undefined' ){
        		owner = 'nobody';
        	}
        	
        	// Make the data that will be posted to the server
        	var data = {
        		"name": lookup_file
        	};
        	
        	// Perform the call
        	$.ajax({
        			url: splunkd_utils.fullpath(['/servicesNS', owner, namespace, 'storage/collections/config'].join('/')),
        			data: data,
        			type: 'POST',
        			
        			// On success, populate the table
        			success: function(data) {
        				console.info('KV store lookup file created');
        			  
        				// Remember the specs on the created file
        				this.lookup = lookup_file;
        				this.namespace = namespace;
        				this.owner = owner;
        				this.lookup_type = "kv";
        				
        				this.kv_store_fields_editor.modifyKVStoreLookupSchema(this.namespace, this.lookup, 'nobody', function(){
        					this.showInfoMessage("Lookup created successfully");
        					document.location = "?lookup=" + lookup_file + "&owner=" + owner + "&type=kv&namespace=" + namespace;
        				}.bind(this));
        			  
        			}.bind(this),
        		  
        			// Handle cases where the file could not be found or the user did not have permissions
        			complete: function(jqXHR, textStatus){
        				if( jqXHR.status == 403){
        					console.info('Inadequate permissions');
        					this.showWarningMessage("You do not have permission to make a KV store collection", true);
        				}
        				else if( jqXHR.status == 409){
        					console.info('Lookup name already exists');
        					$('#lookup-name-control-group', this.$el).addClass('error');
        	        		this.showWarningMessage("Lookup name already exists, please select another");
        				}
        				
        				this.setSaveButtonTitle();
        			  
        			}.bind(this),
        		  
        			// Handle errors
        			error: function(jqXHR, textStatus, errorThrown){
        				if( jqXHR.status != 403 && jqXHR.status != 409 ){
        					console.info('KV store collection creation failed');
        					this.showWarningMessage("The KV store collection could not be created", true);
        				}
        			}.bind(this)
        	});
        	
        },
        
        /**
         * Load the lookup file contents from the server and populate the editor.
         * 
         * @param lookup_file The name of the lookup file
         * @param namespace The app where the lookup file exists
         * @param user The user that owns the file (in the case of user-based lookups)
         * @param lookup_type Indicates whether this is a KV store or a CSV lookup (needs to be either "kv" or "csv")
         * @param header_only Indicates if only the header row should be retrieved
         * @param version The version to get from the archived history
         */
        loadLookupContents: function(lookup_file, namespace, user, lookup_type, header_only, version){
        	
        	// Set a default value for header_only
        	if( typeof header_only === 'undefined' ){
        		header_only = false;
        	}
        	
        	var data = {"lookup_file":lookup_file,
                    	"namespace"  :namespace,
                    	"header_only":header_only,
                    	"lookup_type":lookup_type};
        	
        	// Set a default value for version
        	if( typeof version == 'undefined' ){
        		version = undefined;
        	}
        	
        	// Show the loading message
        	$(".table-loading-message").show(); // TODO replace
        	
        	// Set the version parameter if we are asking for an old version
        	if( version !== undefined && version ){
        		data.version = version;
        	}
        	
        	// If a user was defined, then pass the name as a parameter
        	if(user !== null){
        		data["owner"] = user;
        	}
        	
        	// Make the URL
            url = Splunk.util.make_full_url("/custom/lookup_editor/lookup_edit/get_lookup_contents", data);
        	
        	// Started recording the time so that we figure out how long it took to load the lookup file
        	var populateStart = new Date().getTime();
        	
        	// Perform the call
        	$.ajax({
        		  url: url,
        		  cache: false,
        		  
        		  // On success, populate the table
        		  success: function(data) {
        			  
        			  // Data could not be loaded
        			  if(data == null){
        				  console.error('JSON of lookup table could not be loaded (got an empty value)');
        				  this.showWarningMessage("The requested lookup file could not be loaded", true);
        				  $('.show-when-editing', this.$el).hide();
        			  }
        			  
        			  // Data can be loaded
        			  else{
        				  
        				  // Note that the lookup is empty
        				  if(data.length === 0){
        					  console.error('JSON of lookup table was successfully loaded (though the file is blank)');
            				  this.showWarningMessage("The lookup is blank; edit it to populate it", true);
            				  this.renderLookup(this.getDefaultData());
        				  }
        				  else{
        					  console.info('JSON of lookup table was successfully loaded');
    	        			  this.renderLookup(data);
        				  }
	        			  
	        			  
	        			  var elapsed = new Date().getTime()-populateStart;
	        			  console.info("Lookup loaded and rendered in " + elapsed + "ms");
	        			  
	        			  // Remember the specs on the loaded file
	        			  this.lookup = lookup_file;
	        	          this.namespace = namespace;
	        	          this.owner = user;
	        	          this.lookup_type = lookup_type;
	        	          
	        	          // Update the UI to note which user context is loaded
	        	          $('#loaded-user-context').text(this.owner);
        			  }
        			  
        		  }.bind(this),
        		  
        		  // Handle cases where the file could not be found or the user did not have permissions
        		  complete: function(jqXHR, textStatus){
        			  if( jqXHR.status == 404){
        				  console.info('Lookup file was not found');
        				  this.showWarningMessage("The requested lookup file does not exist", true);
        			  }
        			  else if( jqXHR.status == 403){
        				  console.info('Inadequate permissions');
        				  this.showWarningMessage("You do not have permission to view this lookup file", true);
        			  }
        			  else if( jqXHR.status == 420){
        				  console.info('File is too large');
        				  this.showWarningMessage("The file is too big to be edited (must be less than 10 MB)");
        			  }
        			  
        			  // Hide the loading message
        			  $(".table-loading-message").hide();
        			  
        			  // Start the loading of the history
        			  if( version === undefined && this.lookup_type === "csv" ){
        				  this.loadLookupBackupsList(lookup_file, namespace, user);
        			  }
        			  else if(this.lookup_type === "csv"){
        				  // Show a message noting that the backup was imported
        				  this.showInfoMessage("Backup file was loaded successfully");
        			  }
        			  
        		  }.bind(this),
        		  
        		  // Handle errors
        		  error: function(jqXHR, textStatus, errorThrown){
        			  if( jqXHR.status != 404 && jqXHR.status != 403 && jqXHR.status != 420 ){
        				  console.info('Lookup file could not be loaded');
        				  this.showWarningMessage("The lookup could not be loaded from the server", true);
        			  }
        			  
    				  this.read_only = true;
    				  this.hideEditingControls();
        		  }.bind(this)
        	});
        },
        
        /**
         * Hide the editing controls
         */
        hideEditingControls: function(hide){
        	
        	// Load a default for the version
        	if( typeof hide === 'undefined' ){
        		hide = true;
        	}
        	
        	if(hide){
        		$('.btn', this.$el).hide();
        	}
        	else{
        		$('.btn', this.$el).show();
        	}
        	
        },
        
        /**
         * Validate that the lookup contents are a valid file
         * 
         * @param data The data (array of array) representing the table
         * @returns {Boolean}
         */
        validate: function(data) {
        	
        	// If the cell is the first row, then ensure that the new value is not blank
        	if( data[0][0] === 0 && data[0][3].length === 0 ){
        		return false;
        	}
        },
        
        /**
         * Validate the content of the form
         */
        validateForm: function(){
        	
        	var issues = 0;
        	
        	// By default assume everything passes
        	$('#lookup-name-control-group', this.$el).removeClass('error');
        	$('#lookup-app-control-group', this.$el).removeClass('error');
        	
        	this.hideWarningMessage();
        	
        	// Make sure the lookup name is defined
        	if(this.is_new && (!mvc.Components.getInstance("lookup-name").val() || mvc.Components.getInstance("lookup-name").val().length <= 0)){
        		$('#lookup-name-control-group', this.$el).addClass('error');
        		this.showWarningMessage("Please enter a lookup name");
        		issues = issues + 1;
        	}
        	
        	// Make sure the lookup name is acceptable
        	else if(this.is_new && !mvc.Components.getInstance("lookup-name").val().match(/^[-A-Z0-9_ ]+([.][-A-Z0-9_ ]+)*$/gi)){
        		$('#lookup-name-control-group', this.$el).addClass('error');
        		this.showWarningMessage("Lookup name is invalid");
        		issues = issues + 1;
        	}
        	
        	// Make sure the lookup app is defined
        	if(this.is_new && (! mvc.Components.getInstance("lookup-app").val() || mvc.Components.getInstance("lookup-app").val().length <= 0)){
        		$('#lookup-app-control-group', this.$el).addClass('error');
        		this.showWarningMessage("Select the app where the lookup will reside");
        		issues = issues + 1;
        	}
        	
        	// Make sure at least one field is defined (for KV store lookups only)
        	if(this.is_new && this.lookup_type === "kv" ){
        		
        		var validate_response = this.kv_store_fields_editor.validate();
        		
        		if(validate_response !== true){
            		this.showWarningMessage(validate_response);
            		issues = issues + 1;
        		}
        	}
        	
        	// Determine if the validation passed
        	if(issues > 0){
        		return false;
        	}
        	else{
        		return true;
        	}
        },
        
        /**
         * Get the list of apps as choices.
         */
        getAppsChoices: function(){
        	
        	// If we don't have the apps yet, then just return an empty list for now
        	if(!this.apps){
        		return [];
        	}
        	
        	var choices = [];
        	
        	for(var c = 0; c < this.apps.models.length; c++){
        		choices.push({
        			'label': this.apps.models[c].entry.associated.content.attributes.label,
        			'value': this.apps.models[c].entry.attributes.name
        		});
        	}
        	
        	return choices;
        	
        },
        
        /**
         * Get the apps
         */
        gotApps: function(){
        	
        	// Update the list
        	if(mvc.Components.getInstance("lookup-app")){
        		mvc.Components.getInstance("lookup-app").settings.set("choices", this.getAppsChoices());
        	}
        	
        },
        
        /**
         * Set the title of the save button
         */
        setSaveButtonTitle: function(title){
        	
        	if(typeof title == 'undefined' ){
        		$("#save").text("Save Lookup");
        	}
        	else{
        		$("#save").text(title);
        	}
        	
        },
        
        /**
         * Pad an integer with zeroes.
         */
        pad: function(num, size) {
            var s = num+"";
            while (s.length < size) s = "0" + s;
            return s;
        },
        
        /**
         * Update the modification time
         */
        updateTimeModified: function(){
        	var today = new Date();
        	
        	var am_or_pm = today.getHours() > 12 ? "PM" : "AM";
        	
        	$("#modification-time").text("Modified: " + today.getFullYear() + "/" + this.pad(today.getMonth() + 1, 2) + "/" + today.getDate() + " " + this.pad((today.getHours() % 12),2) + ":" + this.pad(today.getMinutes(), 2) + ":" + this.pad(today.getSeconds(),2) + " " + am_or_pm);
        	
        	$(".modification-time-holder > i").show();
        	$(".modification-time-holder > i").fadeOut(1000);
        },
        
        /**
         * Load the selected backup.
         */
        doLoadBackup: function(evt){
        	var version = evt.currentTarget.dataset.backupTime;
        	
        	if(version){
        		this.loadBackupFile(version);
        		
        		if(this.agent){
            		this.agent.play("Processing");
            	}
        	}
        	
        },
        
        /**
         * Load the lookup from the selected user context.
         */
        doLoadUserContext: function(evt){
        	var user = evt.currentTarget.dataset.user;
        	
        	if(user){
        		this.loadUserKVEntries(user);
        		
        		if(this.agent){
            		this.agent.play("Processing");
            	}
        	}
        	
        },
        
        /**
         * Perform an export of the given file.
         */
        doExport: function(){
        	var href= "../../../custom/lookup_editor/lookup_edit/get_original_lookup_file?namespace=" + this.namespace + "&owner=" + this.owner + "&lookup_file=" + this.lookup + "&type=" + this.lookup_type;
        	document.location = href;
        },
        
        /**
         * Perform the operation to save the lookup
         * 
         * @returns {Boolean}
         */
        doSaveLookup: function(evt){
        	
        	// Determine if we are making a new entry
        	var making_new_lookup = this.is_new;
        	
        	// Change the title
        	this.setSaveButtonTitle("Saving...");
        	
        	if(this.agent){
        		this.agent.play("Save");
        	}
        	
        	// Started recording the time so that we figure out how long it took to save the lookup file
        	var populateStart = new Date().getTime();
        	
        	// Hide the warnings. We will repost them if the input is still invalid
        	this.hideMessages();
        	
        	// Stop if the form didn't validate
        	if(!this.validateForm()){
        		this.setSaveButtonTitle();
        		return;
        	}
        	
        	// If we are making a new KV store lookup, then make it
        	if(making_new_lookup && this.lookup_type === "kv"){
        		this.makeKVStoreLookup(mvc.Components.getInstance("lookup-app").val(), mvc.Components.getInstance("lookup-name").val());
        	}
        	
        	// Otherwise, save the lookup
        	else{
	        	
	        	// Get the row data
	        	row_data = this.handsontable.getData();
	        	
	        	// Convert the data to JSON
	        	json = JSON.stringify(row_data);
	        	
	        	// Make the arguments
	        	var data = {
	        			lookup_file : this.lookup,
	        			namespace   : this.namespace,
	        			contents    : json
	        	};
	        	
	        	// If a user was defined, then pass the name as a parameter
	        	if(this.owner !== null){
	        		data["owner"] = this.owner;
	        	}
	        	
	        	// Validate the input if it is new
	        	if(making_new_lookup){
	        		
		        	// Get the lookup file name from the form if we are making a new lookup
	        		data["lookup_file"] = mvc.Components.getInstance("lookup-name").val();
		
		        	// Make sure that the file name was included; stop if it was not
		        	if (data["lookup_file"] === ""){
		        		$("#lookup_file_error").text("Please define a file name"); // TODO
		        		$("#lookup_file_error").show();
		        		this.setSaveButtonTitle();
		        		return false;
		        	}
		        	
		        	// Make sure that the file name is valid; stop if it is not
		        	if( !data["lookup_file"].match(/^[-A-Z0-9_ ]+([.][-A-Z0-9_ ]+)*$/gi) ){
		        		$("#lookup_file_error").text("The file name contains invalid characters"); // TODO
		        		$("#lookup_file_error").show();
		        		this.setSaveButtonTitle();
		        		return false;
		        	}
		        		
		        	// Get the namespace from the form if we are making a new lookup
		        	data["namespace"] = mvc.Components.getInstance("lookup-app").val();
		
		        	// Make sure that the namespace was included; stop if it was not
		        	if (data["namespace"] === ""){
		        		$("#lookup_namespace_error").text("Please define a namespace");
		        		$("#lookup_namespace_error").show();
		        		this.setSaveButtonTitle();
		        		return false;
		        	}
		        	
		        	// Set the owner if the user wants a user-specific lookup
		        	if($.inArray('user_only', mvc.Components.getInstance("lookup-user-only").val()) >= 0){
		        		data["owner"] = Splunk.util.getConfigValue("USERNAME");
		        	}
		        }
	
	        	// Make sure at least a header exists; stop if not enough content is present
	        	if(row_data.length === 0){		
	        		this.showWarningMessage("Lookup files must contain at least one row (the header)");
	        		return false;
	        	}
	        	
	        	// Make sure the headers are not empty.
	        	// If the editor is allowed to add extra columns then ignore the last row since this for adding a new column thus is allowed
	        	for( i = 0; i < row_data[0].length; i++){
	        		
	        		// Determine if this row has an empty header cell
	        		if( row_data[0][i] === "" ){
	        			this.showWarningMessage("Header rows cannot contain empty cells (column " + (i + 1) + " of the header is empty)");
	        			return false;
	        		}
	        	}
	        	
	        	// Perform the request to save the lookups
	        	$.ajax( {
	        				url:  Splunk.util.make_url('/custom/lookup_editor/lookup_edit/save'),
	        				type: 'POST',
	        				data: data,
	        				
	        				success: function(){
	        					console.log("Lookup file saved successfully");
	        					this.showInfoMessage("Lookup file saved successfully");
	        					this.setSaveButtonTitle();
	        					
	        					// Persist the information about the lookup
	        					if(this.is_new){
		        					this.lookup = data["lookup_file"];
		        					this.namespace = data["namespace"];
		        					this.owner = data["owner"];
		        					this.lookup_type = "csv";
	        					}
	        				}.bind(this),
	        				
	        				// Handle cases where the file could not be found or the user did not have permissions
	        				complete: function(jqXHR, textStatus){
	        					
	        					var elapsed = new Date().getTime()-populateStart;
	        					console.info("Lookup save operation completed in " + elapsed + "ms");
	        					var success = true;
	        					
	        					if(jqXHR.status == 404){
	        						console.info('Lookup file was not found');
	        						this.showWarningMessage("This lookup file could not be found");
	        						success = false;
	        					}
	        					else if(jqXHR.status == 403){
	        						console.info('Inadequate permissions');
	        						this.showWarningMessage("You do not have permission to edit this lookup file");
	        						success = false;
	        					}
	        					else if(jqXHR.status == 400){
	        						console.info('Invalid input');
	        						this.showWarningMessage("This lookup file could not be saved because the input is invalid");
	        						success = false;
	        					}
	        					else if(jqXHR.status == 500){
	        						this.showWarningMessage("The lookup file could not be saved");
	        				    	success = false;
	        					}
	        					
	        					this.setSaveButtonTitle();
	        					
	        					// If we made a new lookup, then switch modes
	        					if(this.is_new && success){
	        						this.changeToEditMode();
	        					}
	        					
	        					// Update the lookup backup list
	        					if(success){
	        						this.loadLookupBackupsList(this.lookup, this.namespace, this.owner);
	        					}
	        				}.bind(this),
	        				
	        				error: function(jqXHR,textStatus,errorThrown) {
	        					console.log("Lookup file not saved");
	        					this.showWarningMessage("Lookup file could not be saved");
	        				}.bind(this)
	        				
	        			}
	        	);
        	}
        	return false;
        },
        
        /**
         * Do an edit to a row cell (for KV store lookups since edits are dynamic).
         */
        doEditCell: function(row, col, new_value){
        	
        	// Stop if we are in read-only mode
        	if(this.read_only){
        		return;
        	}
        	
        	// First, we need to get the _key of the edited row
        	var row_data = this.handsontable.getDataAtRow(row);
        	var _key = row_data[this.getColumnForField('_key')];
        	
        	if(_key === undefined){
        		console.error("Unable to get the _key for editing the cell at (" + row + ", " + col + ")");
        		return;
        	}
        	
        	// Second, we need to get all of the data from the given row because we must re-post all of the cell data
        	var record_data = this.makeRowJSON(row);
        	
        	// If _key doesn't exist, then we will create a new row
        	var url = Splunk.util.make_url("/splunkd/servicesNS/" + this.owner + "/" + this.namespace +  "/storage/collections/data/" + this.lookup + "/" + _key);
        	
        	if(!_key){
        		url = Splunk.util.make_url("/splunkd/servicesNS/" + this.owner + "/" + this.namespace +  "/storage/collections/data/" + this.lookup);
        	}
        	
        	// Third, we need to do a post to update the row
        	$.ajax({
        		url: url,
        		type: "POST",
        		dataType: "json",
        		data: JSON.stringify(record_data),
        		contentType: "application/json; charset=utf-8",
        		
      		  	// On success
      		  	success: function(data) {
      		  		
      		  		this.hideWarningMessage();
      		  		
      		  		// If this is a new row, then populate the _key
      		  		if(!_key){
      		  			_key = data['_key'];
      		  			this.handsontable.setDataAtCell(row, this.getColumnForField("_key"), _key, "key_update");
      		  			console.info('KV store entry creation completed for entry ' + _key);
      		  		}
      		  		else{
      		  			console.info('KV store entry edit completed for entry ' + _key);
      		  		}
      		  		
      		  		this.updateTimeModified();
      		  		
      		  	}.bind(this),
      		  
      		  	// On complete
      		  	complete: function(jqXHR, textStatus){
      		  		
      		  		if( jqXHR.status == 403){
      		  			console.info('Inadequate permissions');
      		  			this.showWarningMessage("You do not have permission to edit this lookup", true);
      		  		}
      		  	
      		  	}.bind(this),
      		  	
      		  	// Handle errors
      		  	error: function(jqXHR, textStatus, errorThrown){
      		  		this.showWarningMessage("Entry could not be saved to the KV store lookup; make sure the value matches the expected type", true);
      		  	}.bind(this)
        	});
        },
        
        /**
         * Do the removal of a row (for KV store lookups since edits are dynamic).
         */
        doRemoveRow: function(row){
        	
        	// Stop if we are in read-only mode
        	if(this.read_only){
        		return;
        	}
        	
        	// First, we need to get the _key of the edited row
        	var row_data = this.handsontable.getDataAtRow(row);
        	var _key = row_data[0];
        	
        	// Second, we need to do a post to remove the row
        	$.ajax({
        		url: Splunk.util.make_url("/splunkd/servicesNS/" + this.owner + "/" + this.namespace +  "/storage/collections/data/" + this.lookup + "/" + _key),
        		type: "DELETE",
        		
      		  	// On success
      		  	success: function(data) {
      		  		console.info('KV store entry removal completed for entry ' + _key);
      		  		this.hideWarningMessage();
      		  		this.updateTimeModified();
      		  	}.bind(this),
      		  	
      		  	// On complete
      		  	complete: function(jqXHR, textStatus){
      		  		
      		  		if( jqXHR.status == 403){
      		  			console.info('Inadequate permissions');
      		  			this.showWarningMessage("You do not have permission to edit this lookup", true);
      		  		}
      		  	
      		  	}.bind(this),
      		  
      		  	// Handle errors
      		  	error: function(jqXHR, textStatus, errorThrown){
      		  		this.showWarningMessage("An entry could not be removed from the KV store lookup", true);
      		  	}.bind(this)
        	});
        },
        
        /**
         * Add the given field to the data with the appropriate hierarchy.
         */
        addFieldToJSON: function(json_data, field, value){
        	
        	var split_field = [];
        	
        	split_field = field.split(".");
        	
    		// If the field has a period, then this is hierarchical field
    		// For these, we need to build the heirarchy or make sure it exists.
    		if(split_field.length > 1){
    			
    			// If the top-most field doesn't exist, create it
    			if(!(split_field[0] in json_data)){
    				json_data[split_field[0]] = {};
    			}
    			
    			// Recurse to add the children
    			return this.addFieldToJSON(json_data[split_field[0]], split_field.slice(1).join("."), value);
    		}
    		
    		// For non-hierarchical fields, we can just add them
    		else{
    			json_data[field] = value;
    			
    			// This is the base case
    			return json_data;
    		}
        	
        },
        
        /**
         * Make JSON for the given row.
         */
        makeRowJSON: function(row){
        	
        	// We need to get the row meta-data and the 
        	var row_header = this.getTableHeader();
        	var row_data = this.handsontable.getDataAtRow(row);
        	
        	// This is going to hold the data for the row
        	var json_data = {};
        	
        	// Add each field / column
        	for(var c=1; c < row_header.length; c++){
        		
        		// Determine the column type if we can
        		var column_type = this.getFieldType(c);
        		
        		// This will store the transformed value (by default, it is the original)
        		var value = row_data[c];
        		
        		// If this is a datetime, then convert it to epoch integer
        		if(column_type === "time"){
        			value = new Date(value).valueOf();
        		}
        		
        		// Don't allow undefined through
        		if(value === undefined){
        			value = '';
        		}
        		
        		this.addFieldToJSON(json_data, row_header[c], value);
        	}
        	
        	// Return the created JSON
        	return json_data;
        },
        
        /**
         * Do the creation of a row (for KV store lookups since edits are dynamic).
         */
        doCreateRows: function(row, count){
        	
        	// Stop if we are in read-only mode
        	if(this.read_only){
        		return;
        	}
        	
        	// Create entries for each row to create
        	var record_data = [];
        	
        	for(var c=0; c < count; c++){
        		record_data.push(this.makeRowJSON(row + c));
        	}
        	
        	// Third, we need to do a post to create the row
        	$.ajax({
        		url: Splunk.util.make_url("/splunkd/servicesNS/" + this.owner + "/" + this.namespace +  "/storage/collections/data/" + this.lookup + "/batch_save"),
        		type: "POST",
        		dataType: "json",
        		data: JSON.stringify(record_data),
        		contentType: "application/json; charset=utf-8",
        		
      		  	// On success
      		  	success: function(data) {
      		  		// Update the _key values in the cells
      		  		for(var c=0; c < data.length; c++){
      		  			this.handsontable.setDataAtCell(row + c, this.getColumnForField("_key"), data[c], "key_update")
      		  		}
      		  		
      		  		this.hideWarningMessage();
      		  		this.updateTimeModified();
      		  		
      		  	}.bind(this),
      		  	
      		  	// On complete
      		  	complete: function(jqXHR, textStatus){
      		  		
      		  		if( jqXHR.status == 403){
      		  			console.info('Inadequate permissions');
      		  			this.showWarningMessage("You do not have permission to edit this lookup", true);
      		  		}
      		  	
      		  	}.bind(this),
      		  
      		  	// Handle errors
      		  	error: function(jqXHR, textStatus, errorThrown){
      		  		// This error can be thrown when the lookup requires a particular type
      		  		//this.showWarningMessage("Entries could not be saved to the KV store lookup", true);
      		  	}.bind(this)
        	});
        },
        
        /**
         * Get colummn configuration data for the columns so that the table presents a UI for editing the cells appropriately. 
         */
        getColumnsMetadata: function(){
        	
        	// Stop if we don't have the required data yet
        	if(!this.getTableHeader()){
        		console.warn("The table header is not available yet")
        	}
        	
        	// If this is a CSV lookup, then add a column renderer to excape the content
        	var table_header = this.getTableHeader();
        	var column = null;
        	var columns = []; 
        	
        	// Stop if we didn't get the types necessary
        	if(!this.field_types){
        		console.warn("The table field types are not available yet")
        	}
        	
        	// This variable will contain the meta-data about the columns
        	// Columns is going to have a single field by default for the _key field which is not included in the field-types
        	var field_info = null;
        	
        	for(var c = 0; c < table_header.length; c++){
        		field_info = this.field_types[table_header[c]];
        		
        		column = {};
        		
        		// Use a checkbox for the boolean
        		if(field_info === 'boolean'){
        			column['type'] = 'checkbox';
        			column['editor'] = this.getCheckboxRenderer();
        		}
        		
        		// Use format.js for the time fields
        		else if(field_info === 'time'){
        			column['type'] = 'time';
        			column['timeFormat'] = 'YYYY/MM/DD HH:mm:ss';
        			column['correctFormat'] = true;
        			column['renderer'] = this.timeRenderer.bind(this); // Convert epoch times to a readable string
        			column['editor'] = this.getTimeRenderer();
        		}
        		
        		// Handle number fields
        		else if(field_info === 'number'){
        			column['type'] = 'numeric';
        		}
        		
        		columns.push(column);
        		
    		}
    		
        	return columns;
        	
        },
        
        /**
         * Re-render the Hands-on-table instance
         */
        reRenderHandsOnTable: function(){
        	
        	// Re-render the view
        	if($("#lookup-table").length > 0 && this.handsontable){
            	if(this.handsontable){
            		this.handsontable.render(); 
            	}
        	}
        },
        
        /**
         * Add some empty rows to the lookup data.
         */
        addEmptyRows: function(data, column_count, row_count){
        	var row =[];
        	
        	for(var c = 0; c < column_count; c++){
        		row.push('');
        	}
        	
        	for(c = 0; c < row_count; c++){
        		data.push($.extend(true, [], row));
        	}
        	
        },
        
        /**
         * Get checkbox cell renderer that doesn't lock users out of fixing values that are invalid booleans.
         */
        getCheckboxRenderer: function(){
        	
        	// Return the existing checkbox editor
        	if(this.forgiving_checkbox_editor !== null){
        		return this.forgiving_checkbox_editor;
        	}
        	
        	this.forgiving_checkbox_editor = Handsontable.editors.CheckboxEditor.prototype.extend();
        	
        	this.forgiving_checkbox_editor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        		
        		// If the value is invalid, then set it to false and allow the user to edit it
        		if(originalValue !== true && originalValue !== false){
            		console.warn("This cell is not a boolean value, it will be populated with 'false', cell=(" + row + ", " + col + ")");
            		this.instance.setDataAtCell(row, col, false);
        		}
        		
        		Handsontable.editors.CheckboxEditor.prototype.prepare.apply(this, arguments);
        	};
        	
        	return this.forgiving_checkbox_editor;
        },
        
        /**
         * Get time renderer that handles conversion from epoch to a string so that the user doesn't have to edit a number.
         */
        getTimeRenderer: function(){
        	
        	// Return the existing editor
        	if(this.time_editor !== null){
        		return this.time_editor;
        	}
        	
        	this.time_editor = Handsontable.editors.TextEditor.prototype.extend();
        	
        	var formatTime = this.formatTime;
        	
        	this.time_editor.prototype.prepare = function(row, col, prop, td, originalValue, cellProperties){
        		// Convert the seconds-since-epoch to a nice string.
        		Handsontable.editors.TextEditor.prototype.prepare.apply(this, [row, col, prop, td, formatTime(originalValue), cellProperties]);
        	};
        	
        	return this.time_editor;
        },
        
        /**
         * Escape HTML content
         */
        escapeHtmlRenderer: function(instance, td, row, col, prop, value, cellProperties) {
        	td.innerHTML = this.escapeHtml(Handsontable.helper.stringify(value));

            return td;
        },
        
        /**
         * Format the time into the standard format.
         */
        formatTime: function(value){
        	if(/^\d+$/.test(value)){
        		return moment(parseInt(value, 10)).format('YYYY/MM/DD HH:mm:ss');
        	}
        	else{
        		return value;
        	}
        },
        
        /**
         * Render time content (converts the epochs to times)
         */
        timeRenderer: function(instance, td, row, col, prop, value, cellProperties) {
        	value = this.escapeHtml(Handsontable.helper.stringify(value));
            
        	td.innerHTML = this.formatTime(value);

            return td;
        },
        
        /**
         * Render the lookup.
         */
        renderLookup: function(data){
        	
        	if(data === null){
        		this.showWarningMessage("Lookup could not be loaded");
        		return;
        	}
        	
        	// Store the table header so that we can determine the relative offsets of the fields
        	this.table_header = data[0];
        	
        	// If the handsontable has already rendered, then re-render the existing one.
        	if(this.handsontable !== null){
        		this.handsontable.destroy();
        		this.handsontable = null;
        	}
    		
    		// If we are editing a KV store lookup, use these menu options
        	var contextMenu = null;
        
        	var read_only = this.read_only;
        		
        	if(this.lookup_type === "kv"){
	    		contextMenu = {
	    				items: {
	    					'row_above': {
	    						disabled: function () {
	    				            // If read-only or the first row, disable this option
	    				            return this.read_only || (this.handsontable.getSelected() === undefined);
	    				        }.bind(this)
	    					},
	    					'row_below': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					"hsep1": "---------",
	    					'remove_row': {
	    						disabled: function () {
	    							// If read-only or the first row, disable this option
	    				            return this.read_only || (this.handsontable.getSelected() === undefined);
	    				        }.bind(this)
	    					},
	    					'hsep2': "---------",
	    					'undo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'redo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					}
	    				}
	    		}
        	}
        	else{
	    		contextMenu = {
	    				items: {
	    					'row_above': {
	    						disabled: function () {
	    				            // If read-only or the first row, disable this option
	    				            return this.read_only || (this.handsontable.getSelected() !== undefined && this.handsontable.getSelected()[0] === 0);
	    				        }.bind(this)
	    					},
	    					'row_below': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					"hsep1": "---------",
	    					'col_left': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'col_right': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'hsep2': "---------",
	    					'remove_row': {
	    						disabled: function () {
	    							// If read-only or the first row, disable this option
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'remove_col': {
	    						disabled: function () {
	    							// If read-only or the first row, disable this option
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'hsep3': "---------",
	    					'undo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					},
	    					'redo': {
	    						disabled: function () {
	    				            return this.read_only;
	    				        }.bind(this)
	    					}
	    				}
	    		}
        	}
        	
        	// Put in a class name so that the styling can be done by the type of the lookup
        	if(this.lookup_type === "kv"){
        		$("#lookup-table").addClass('kv-lookup');
        		this.columns = this.getColumnsMetadata();
        	}
        	else{
        		$("#lookup-table").addClass('csv-lookup');
        	}
        	
        	// Make sure some empty rows exist if it is empty
        	if(data.length === 1){
        		this.addEmptyRows(data, data[0].length, 5);
        	}
        	
        	// Make the handsontable instance
        	this.handsontable = new Handsontable($("#lookup-table")[0], {
        		  data: this.lookup_type === "kv" ? data.slice(1) : data,
        		  startRows: 1,
        		  startCols: 1,
        		  contextMenu: contextMenu,
        		  minSpareRows: 0,
        		  minSpareCols: 0,
        		  colHeaders: this.lookup_type === "kv" ? this.table_header : false,
        		  columns: this.columns,
        		  rowHeaders: true,
        		  fixedRowsTop: this.lookup_type === "kv" ? 0 : 1,
        		  height: function(){ return $(window).height() - 320; }, // Set the window height so that the user doesn't have to scroll to the bottom to set the save button
        		  
        		  stretchH: 'all',
        		  manualColumnResize: true,
        		  manualColumnMove: true,
        		  onBeforeChange: this.validate.bind(this),
        		  
        		  allowInsertColumn: this.lookup_type === "kv" ? false : true,
        		  allowRemoveColumn: this.lookup_type === "kv" ? false : true,
        		  
        		  renderer: this.lookupRenderer.bind(this),
        		  
        		  cells: function(row, col, prop) {
        			  
        			  var cellProperties = {};
        			  
        			  // Don't allow the _key row to be editable on KV store lookups since the keys are auto-assigned
        		      if (this.read_only || (this.lookup_type === "kv" && col == 0)) {
        		        cellProperties.readOnly = true;
        		      }

        		      return cellProperties;
        		  }.bind(this),
        		
        		  beforeRemoveRow: function(index, amount){
        			  
        			  // Don't allow deletion of all cells
        			  if( (this.countRows() - amount) <= 0){
        				  alert("A valid lookup file requires at least one row (for the header).");
        				  return false;
        			  }
        			  
        			  // Warn about the header being deleted and make sure the user wants to proceed.
        			  if(index == 0){
        				  var continue_with_deletion = confirm("Are you sure you want to delete the header row?\n\nNote that a valid lookup file needs at least a header.");
        				  
        				  if (!continue_with_deletion){
        					  return false;
        				  }
        			  }
        		  },
        		  
        		  beforeRemoveCol: function(index, amount){
        			  
        			  // Don't allow deletion of all cells
        			  if( (this.countCols() - amount) <= 0){
        				  alert("A valid lookup file requires at least one column.");
        				  return false;
        			  }
        		  },
        		  
        		  // Don't allow removal of all columns
        		  afterRemoveCol: function(index, amount){
        			  if(this.countCols() == 0){
        				  alert("You must have at least one cell to have a valid lookup");
        			  }
        		  },
        		  
        		  // Update the cached version of the table header
        		  afterColumnMove: function(){
        			  this.getTableHeader(false);
        		  }.bind(this)
            });
        	
        	// Wire-up handlers for doing KV store dynamic updates
        	if(this.lookup_type === "kv"){

        		// For cell edits
        		this.handsontable.addHook('afterChange', function(changes, source) {

        			// Ignore changes caused by the script updating the _key for newly added rows
        			if(source === "key_update"){
        				return;
        			}

        			// If there are no changes, then stop
        			if(!changes){
        				return;
        			}

        			// Iterate and change each cell
        			for(var c = 0; c < changes.length; c++){
        				var row = changes[c][0];
        				var col = changes[c][1];
        				var new_value = changes[c][3];

        				this.doEditCell(row, col, new_value);
        			}

        		}.bind(this));

        		// For row removal
        		this.handsontable.addHook('beforeRemoveRow', function(index, amount) {

        			// Iterate and remove each row
        			for(var c = 0; c < amount; c++){
        				var row = index + c;		        		
        				this.doRemoveRow(row);
        			}

        		}.bind(this));

        		// For row creation
        		this.handsontable.addHook('afterCreateRow', this.doCreateRows.bind(this));

        	}
        	
        },
        
        /**
         * Get the parameter with the given name.
         */
        getParameterByName: function(name) {
            name = name.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
            
            var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
                results = regex.exec(location.search);
            
            return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
        },
        
        /**
         * Hide the given item while retaining the display value
         */
        hide: function(selector){
        	selector.css("display", "none");
        	selector.addClass("hide");
        },
        
        /**
         * Un-hide the given item.
         * 
         * Note: this removes all custom styles applied directly to the element.
         */
        unhide: function(selector){
        	selector.removeClass("hide");
        	selector.removeAttr("style");
        },
        
        /**
         * Change from the new mode of the editor to the edit mode
         */
        changeToEditMode: function(){
        	
        	// Set the lookup name
        	$('#lookup-name-static', this.$el).text(this.lookup);
        	this.unhide($('#lookup-name-static', this.$el));
        	
        	// Hide the creation controls
        	this.hide($('.show-when-creating', this.$el));
        	
        	// Change the title
        	$('h2', this.$el).text("Edit Lookup");
        	
        	// Remember that we are not editing a file
			this.is_new = false;
			
			// Change the URL
			var url = "?lookup=" + this.lookup + "&namespace=" + this.namespace + "&type=" + this.lookup_type;
			
			if(this.owner){
				url += "&owner=" + this.owner;
			}
			else{
				url += "&owner=nobody";
			}
			
			history.pushState(null, "Lookup Edit",url);
        },
        
        /**
         * Handle shortcut key-presses.
         */
        handleShortcuts: function(e){
        	if (e.keyCode == 69 && e.ctrlKey) {
                this.toggleClippy();
            }
        },
        
        /**
         * Turn clippy on or off.
         */
        toggleClippy: function(){
        	
        	// Make the clippy instance if necessary
        	if(this.agent === null){
            	clippy.load('Clippy', function(agent) {
                    this.agent = agent;
                    this.agent.show();
                }.bind(this));
        	}
        	
        	// Show clippy if he was made but is hidden
        	else if($(".clippy").length == 0 || !$(".clippy").is(":visible")){
        		this.agent.show();
        	}
        	
        	// Hide clippy if he was made and is shown
        	else if($(".clippy").length > 0 && $(".clippy").is(":visible")){
        		this.agent.hide();
        	}
        },
        
        /**
         * Get a list of users.
         */
        getUsers: function(owner){
        	
        	// Get a promise ready
        	var promise = jQuery.Deferred();
        	
        	// Make the URL to get the list of users
        	var uri = Splunk.util.make_url("/splunkd/__raw/services/admin/users?output_mode=json");

        	// Let's do this
        	jQuery.ajax({
            	url:     uri,
                type:    'GET',
                async:   false,
                success: function(result) {
                	promise.resolve(this.makeUsersList(owner, result.entry));
                }.bind(this),
                error: function() {
                	// This typlically happens when the user doesn't have access to the list of users (a non-admin account)
                	promise.resolve(this.makeUsersList(owner));
                }.bind(this)
            });
        	
        	return promise;
        	
        },
        
        /**
         * Update the 
         */
        renderUserList: function(users){
        	
        	// Create the list
        	
        	
        	
        	// Update the current user info
        	
        	// Purge the existing list
        	//$('#load-user-context > ul').remove();
        	
        	// Make the list
        	var userTemplate = 	'<% for(var c = 0; c < users.length; c++){ %> \
									<li> \
										<a class="user-context" href="#" data-user="<%- users[c].name %>"> \
										<%- users[c].readable_name %> \
										<% if(users[c].description){ %> \
											(<%- users[c].description %>) \
										<% } %> \
										</a> \
									</li> \
								<% } %>';
        	
        	$('#load-user-context > ul', this.$el).html(_.template(userTemplate, {
        		'users' : users
        	}));
        	
        	//$('#load-user-context > ul').append("<li></li>");
        	
	        // Update the UI to note which user context is loaded
	        //$('#loaded-user-context').text(this.owner);
        	
        	
        },
        
        /**
         * Create a list of users for the lookup context dialog
         */
        makeUsersList: function(owner, users_list_from_splunk){
        	
        	// Set a default value for version
        	if( typeof users_list_from_splunk == 'undefined' ){
        		users_list_from_splunk = [];
        	}
        	
        	// Make a list of users to show from which to load the context
        	var users = [];
        	var user = null;
        	
        	for(var c = 0; c < users_list_from_splunk.length; c++){
        		user = users_list_from_splunk[c];
        		
        		// Populate the description
        		var description = '';
        		
        		if(user.name === owner){
        			description = 'owner of the lookup';
        		}
        		
        		if(user.name === 'nobody'){
        			description = 'entries visible from search';
        		}
        		
        		// Add the user
            	users.push({
            		'name' : user.name,
            		'readable_name' : user.content.realname.length > 0 ? user.content.realname : user.name,
            		'description' : description
            	});
        	}
        	
        	// If we didn't get users, then populate it manually
        	if(users_list_from_splunk.length === 0){
            	// Add the owner
            	users.push({
            		'name' : owner,
            		'readable_name' : owner,
            		'description' : 'owner of the lookup'
            	});
            	
            	// Add myself
            	users.push({
            		'name' : Splunk.util.getConfigValue("USERNAME"),
            		'readable_name' : Splunk.util.getConfigValue("USERNAME"),
            		'description' : ''
            	});
        	}
        	
        	// Add nobody
        	users.push({
        		'name' : 'nobody',
        		'readable_name' : 'nobody',
        		'description' : 'entries visible from search'
        	});
        	
        	return _.uniq(users, function(item, key, a) { 
        	    return item.name;
        	});
        },
        
        /**
         * Get a default table.
         */
        getDefaultData: function(){
        	return   [
    		            ["Column1", "Column2", "Column3", "Column4", "Column5", "Column6"],
    		            ["", "", "", "", "", ""],
    		            ["", "", "", "", "", ""],
    		            ["", "", "", "", "", ""],
    		            ["", "", "", "", "", ""]
    		          ];
        },
        
        /**
         * Render the page.
         */
        render: function () {
        	
        	// Get the information from the lookup to load
        	this.lookup = this.getParameterByName("lookup");
        	this.namespace = this.getParameterByName("namespace");
        	this.owner = this.getParameterByName("owner");
        	this.lookup_type = this.getParameterByName("type");
        	
        	// Determine if we are making a new lookup
        	this.is_new = false;
        	
        	if(this.lookup == "" && this.namespace == "" && this.owner == ""){
        		this.is_new = true;
        	}
        	
        	// Get a list of users to show from which to load the context
        	var users = this.makeUsersList(this.owner);
        	
        	// Render the HTML content
        	this.$el.html(_.template(Template, {
        		'insufficient_permissions' : false,
        		'is_new' : this.is_new,
        		'lookup_name': this.lookup,
        		'lookup_type' : this.lookup_type,
        		'users' : users
        	}));
        	
        	// Setup a handler for the shortcuts
        	$(document).keydown(this.handleShortcuts.bind(this));
        	console.info("Press CTRL + E to see something interesting");
        	
            // Show the content that is specific to making new lookups
        	if(this.is_new){
        		
	        	// Make the lookup name input
	        	var name_input = new TextInput({
	                "id": "lookup-name",
	                "searchWhenChanged": false,
	                "el": $('#lookup-name', this.$el)
	            }, {tokens: true}).render();
        		
	        	name_input.on("change", function(newValue) {
                	this.validateForm();
                }.bind(this));
        		
	        	// Make the app selection drop-down
                var app_dropdown = new DropdownInput({
                    "id": "lookup-app",
                    "selectFirstChoice": false,
                    "showClearButton": false,
                    "el": $('#lookup-app', this.$el),
                    "choices": this.getAppsChoices()
                }, {tokens: true}).render();
                
                app_dropdown.on("change", function(newValue) {
                	this.validateForm();
                }.bind(this));
                
                
                // Make the user-only lookup checkbox
                var user_only_checkbox = new CheckboxGroupInput({
		            "id": "lookup-user-only",
		            "choices": [{label:"User-only", value: "user_only"}],
		            "el": $('#lookup-user-only')
		        }, {tokens: true}).render();
		
		        user_only_checkbox.on("change", function(newValue) {
		        	this.validateForm();
		        }.bind(this));

        	}
        	
        	// Setup the handlers so that we can make the view support drag and drop
            this.setupDragDropHandlers();
        	
        	// If we are editing an existing KV lookup, then get the information about the lookup and _then_ get the lookup data
        	if(this.lookup_type === "kv" && !this.is_new){
        		
            	// Get the info about the lookup configuration (for KV store lookups)
	        	this.lookup_config = new KVLookup();
	        	
	        	this.lookup_config.fetch({
	        		// e.g. servicesNS/nobody/lookup_editor/storage/collections/config/test
	        		url: splunkd_utils.fullpath(['/servicesNS', 'nobody', this.namespace, 'storage/collections/config', this.lookup].join('/')), // For some reason using the actual owner causes this call to fail
	                success: function(model, response, options) {
	                    console.info("Successfully retrieved the information about the KV store lookup");
	                    
	                    // Determine the types of the fields
	                    for (var possible_field in model.entry.associated.content.attributes) {
	                    	// Determine if this a field
	                    	if(possible_field.indexOf('field.') === 0){
	                    		
	                    		// Save the type if it is a field
	                    		this.field_types[possible_field.substr(6)] = model.entry.associated.content.attributes[possible_field];
	                    	}
	                    }
	                    
	                    // Determine if types are enforced
	                    if(model.entry.associated.content.attributes.hasOwnProperty('enforceTypes')){
	                    	if(model.entry.associated.content.attributes.enforceTypes === "true"){
	                    		this.field_types_enforced = true;
	                    	}
	                    	else{
	                    		this.field_types_enforced = false;
	                    	}
	                    }
	                    
	                    // If this lookup cannot be edited, then set the editor to read-only
	                    if(!model.entry.acl.attributes.can_write){
	                    	this.read_only = true;
	                    	this.showWarningMessage("You do not have permission to edit this lookup; it is being displayed read-only");
	                    }
	                    
	                }.bind(this),
	                error: function() {
	                	console.warn("Unable to retrieve the information about the KV store lookup");
	                }.bind(this),
	                complete: function(){
	                	this.loadLookupContents(this.lookup, this.namespace, this.owner, this.lookup_type);
	                }.bind(this)
	        	});
        	}
        	
        	// If we are making an new KV lookup, then show the form that allows the user to define the meta-data
        	else if(this.lookup_type === "kv" && this.is_new){
        		
        		this.kv_store_fields_editor = new KVStoreFieldEditor({
        			'el' : $('#lookup-kv-store-edit', this.$el)
        		});
        		
        		this.kv_store_fields_editor.render();
        		
        		$('#lookup-kv-store-edit', this.$el).show();
        		$('#save', this.$el).show();
        		$('#lookup-table', this.$el).hide();
        	}
        	
        	// If this is a new lookup, then show default content accordingly
        	else if(this.is_new){
        		
        		// Show a default lookup if this is a new lookup
        		this.renderLookup(this.getDefaultData());
        	}
        	
        	// Stop if we didn't get enough information to load a lookup
        	else if(this.lookup == "" || this.namespace == "" || this.owner == ""){
        		this.showWarningMessage("Not enough information to identify the lookup file to load");
        	}
        	
        	// Otherwise, load the lookup
        	else{
        		this.loadLookupContents(this.lookup, this.namespace, this.owner, this.lookup_type);
        	}
        	
        	
        	// Get a list of users to show from which to load the context
            $.when(this.getUsers(this.owner)).done(function(users){
            	console.info("Rendering users list");
            	this.renderUserList(users);
      		}.bind(this));
        	
        }
    });
    
    return LookupEditView;
});