
require.config({
    paths: {
        text: "../app/lookup_editor/js/lib/text",
        console: '../app/lookup_editor/js/lib/console'
    }
});

define([
    "underscore",
    "backbone",
    "models/SplunkDBase",
    "collections/SplunkDsBase",
    "splunkjs/mvc",
    "jquery",
    "splunkjs/mvc/simplesplunkview",
    "splunkjs/mvc/simpleform/input/text",
    "collections/services/data/TransformsLookups",
    "models/services/data/TransformsLookup",
    "text!../app/lookup_editor/js/templates/LookupTransformCreateView.html",
    "util/splunkd_utils",
    "css!../app/lookup_editor/css/LookupTransformCreateView.css",
], function(
    _,
    Backbone,
    SplunkDBaseModel,
    SplunkDsBaseCollection,
    mvc,
    $,
    SimpleSplunkView,
    TextInput,
    TransformsLookups,
    TransformsLookup,
    Template,
    splunkd_utils
){
    var LookupTransformCreateView = SimpleSplunkView.extend({
        className: "LookupTransformCreateView",
        
        defaults: {
            callback: null
        },
        
        /**
         * Initialize the class.
         */
        initialize: function() {
            this.options = _.extend({}, this.defaults, this.options);
            
            this.callback = this.options.callback;

            // This will contain the list of the transforms
            this.transforms = null;

            // This will be the lookup transform that was created
            this.lookup_transform = null;

            // This will be the control for the transform name
            this.name_input = null;
        },

        events: {
            "click #save" : "onCreate",

            // This is used to fix some wierdness with bootstrap and input focus
            "shown #lookup-transform-modal" : "focusView",
        },

        /**
         * Show the modal.
         */
        show: function(owner, namespace, lookup, fields) {
            this.owner = owner;
            this.namespace = namespace;
            this.lookup = lookup;
            this.fields = fields;

            this.save_pressed = false;

            // Clear the existing value so that it doesn't carry over
            mvc.Components.getInstance("transform-name").val('');

            // Hide the warning message
            this.hideWarningMessage();

            // Open the modal
            this.$('#lookup-transform-modal').modal();
        },

        /**
         * Fixes an issue where clicking an input loses focus instantly due to a problem in Bootstrap.
         * 
         * http://stackoverflow.com/questions/11634809/twitter-bootstrap-focus-on-textarea-inside-a-modal-on-click
         */
        focusView: function(){
            this.$('#transform-name input').focus();
            
        },

        /**
         * Create the transform and call the callback once it is done if necessary.
         */
        onCreate: function(){
            this.save_pressed = true;

            if(this.validateForm()){
                $.when(this.createTransform(this.owner, this.namespace, this.lookup, mvc.Components.getInstance("transform-name").val(), this.fields)).done(function(){
                    if(this.callback){
                        this.callback();
                    }
                }.bind(this));
            }
        },
    
        /**
         * Show a warning message on the form.
         */
        showWarningMessage: function(message){
            this.$('.alert').show();
            this.$('#message').text(message);
        },

        /**
         * Hide the warning message.
         */
        hideWarningMessage: function(){
            this.$('.alert').hide();
        },

        /**
         * Create the transform.
         */
        createTransform: function(owner, namespace, lookup, transform_name, fields) {
            // Create the model to save
            var lookupTransform = new TransformsLookup();

            // Get a promise ready
            var promise = jQuery.Deferred();

            // Modify the model
            lookupTransform.entry.content.set('collection', lookup);
            lookupTransform.entry.content.set('external_type', 'kvstore');
            lookupTransform.entry.content.set('name', transform_name);
            lookupTransform.entry.content.set('fields_list', fields);

            // Kick off the request to edit the entry
            lookupTransform.save({}, {
                data: {
                    app: namespace,
                    owner: 'nobody',
                },
            }).done(() => {
                // If successful, close the dialog and run the search
                this.$('#lookup-transform-modal').modal('hide');
                this.openInSearch(transform_name);

                promise.resolve();
            }).fail(response => {
                if(response.status === 490){
                    this.showWarningMessage('A transform with this name already exists');
                }
                else{
                    this.showWarningMessage('The transform could not be created (got an error from the server)');
                }
                
                // Otherwise, show a failure message
                promise.reject();
            });
            
            // Return the promise
            return promise;
        },

        /**
         * Get the list of transforms.
         */
        gotTransforms: function() {
            
        },

        /**
         * Validate the form.
         */
        validateForm: function() {
            if(mvc.Components.getInstance("transform-name").val().length === 0){
                if(this.save_pressed){
                    this.showWarningMessage('Please enter the name of the transform to create');
                }
                return false;
            }
            else{
                return true;
            }
        },

        /**
         * Open the given lookup in the search page.
         */
        openInSearch: function(lookup_transform) {
            window.open('search?q=%7C%20inputlookup%20append%3Dt%20' + lookup_transform, '_blank');
        },

        /**
         * Render the page.
         */
        render: function() {
            this.$el.html(Template);
            
            // Get the transforms
            this.transforms = new TransformsLookups();
            this.transforms.on('reset', this.gotTransforms.bind(this), this);

            this.transforms.fetch({
                success: function () {
                    console.info("Successfully retrieved the list of transforms");
                },
                error: function () {
                    console.error("Unable to fetch the transforms");
                }
            });

            // Make the input for the transform name
			this.name_input = new TextInput({
				"id": "transform-name",
				"searchWhenChanged": false,
				"el": $('#transform-name', this.$el)
			}, {tokens: true}).render();
						
			this.name_input.on("change", function(newValue) {
			    this.validateForm();
			}.bind(this));
        }
    });
   
    return LookupTransformCreateView;
});