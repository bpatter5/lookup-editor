"""
This controller provides helper methods to the front-end views that manage lookup files.
"""

import logging
import os
import sys
import csv
import json
import datetime
import shutil

from splunk.appserver.mrsparkle.lib.util import make_splunkhome_path
from splunk import AuthorizationFailed, ResourceNotFound

from lookup_editor import LookupEditor
from lookup_editor import shortcuts
from lookup_editor.exceptions import LookupFileTooBigException, PermissionDeniedException
from lookup_editor.lookupfiles import get_temporary_lookup_file, SplunkLookupTableFile, update_lookup_table

import rest_handler

if sys.platform == "win32":
    import msvcrt
    # Binary mode is required for persistent mode on Windows.
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stderr.fileno(), os.O_BINARY)

# The default of the csv module is 128KB; upping to 10MB. See SPL-12117 for
# the background on issues surrounding field sizes.
# (this method is new in python 2.5)
csv.field_size_limit(10485760)

def setup_logger(level):
    """
    Setup a logger for the REST handler
    """

    logger = logging.getLogger('splunk.appserver.lookup_editor.rest_handler')
    logger.propagate = False # Prevent the log messages from being duplicated in the python.log file
    logger.setLevel(level)

    log_file_path = make_splunkhome_path(['var', 'log', 'splunk', 'lookup_editor_rest_handler.log'])
    file_handler = logging.handlers.RotatingFileHandler(log_file_path, maxBytes=25000000,
                                                        backupCount=5)

    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger

logger = setup_logger(logging.DEBUG)

class LookupEditorHandler(rest_handler.RESTHandler):
    """
    This is a REST handler that supports editing lookup files. All calls from the user-interface
    should pass through this handler.
    """

    def __init__(self, command_line, command_arg):
        super(LookupEditorHandler, self).__init__(command_line, command_arg, logger)

        self.lookup_editor = LookupEditor(logger)

    def get_lookup_info(self, request_info, lookup_file=None, namespace="lookup_editor", **kwargs):
        """
        Get information about a lookup file (owner, size, etc.)
        """

        return {
            'payload': str(lookup_file),  # Payload of the request.
            'status': 200                 # HTTP status code
            }

    def get_lookup_backups(self, request_info, lookup_file=None, namespace=None, owner=None, **kwargs):
        """
        Get a list of the lookup file backups rendered as JSON.
        """

        backups = self.lookup_editor.get_backup_files(request_info.session_key, lookup_file, namespace, owner)

        # Make the response
        backups_meta = []

        for backup in backups:
            try:
                backups_meta.append(
                    {
                        'time': backup,
                        'time_readable' : datetime.datetime.fromtimestamp(float(backup)).strftime('%Y-%m-%d %H:%M:%S')
                    }
                )
            except ValueError:
                self.logger.warning("Backup file name is invalid, file_name=%s", backup)

        # Sort the list
        backups_meta = sorted(backups_meta, key=lambda x: float(x['time']), reverse=True)

        return self.render_json(backups_meta)

    def get_lookup_contents(self, request_info, lookup_file=None, namespace="lookup_editor",
                             owner=None, header_only=False, version=None, lookup_type=None,
                             **kwargs):
        """
        Provides the contents of a lookup file as JSON.
        """

        self.logger.info("Retrieving lookup contents, namespace=%s, lookup=%s, type=%s, owner=%s,"
                         " version=%s", namespace, lookup_file, lookup_type, owner, version)

        if lookup_type is None or len(lookup_type) == 0:
            lookup_type = "csv"
            self.logger.warning("No type for the lookup provided when attempting to load a lookup" +
                                " file, it will default to CSV")

        if header_only in ["1", "true", 1, True]:
            header_only = True
        else:
            header_only = False

        try:

            # Load the KV store lookup
            if lookup_type == "kv":
                return self.render_json(self.lookup_editor.get_kv_lookup(lookup_file, namespace, owner))

            # Load the CSV lookup
            elif lookup_type == "csv":

                with self.lookup_editor.get_lookup(request_info.session_key, lookup_file, namespace,
                                                   owner, version=version,
                                     throw_exception_if_too_big=True) as csv_file:

                    csv_reader = csv.reader(csv_file)

                    # Convert the content to JSON
                    lookup_contents = []

                    for row in csv_reader:
                        lookup_contents.append(row)

                        # If we are only loading the header, then stop here
                        if header_only:
                            break

                    return self.render_json(lookup_contents)

            else:
                self.logger.warning('Lookup file type is not recognized,' +
                                    ' lookup_type=' + lookup_type)
                return self.render_error_json('Lookup file type is not recognized', 421)

        except IOError:
            self.logger.warning("Unable to find the requested lookup")
            return self.render_error_json("Unable to find the lookup", 404)

        except (AuthorizationFailed, PermissionDeniedException) as e:
            self.logger.warning("Access to lookup denied")
            return self.render_error_json(str(e), 403)

        except LookupFileTooBigException as e:
            self.logger.warning("Lookup file is too large to load")

            data = {
                'message': 'Lookup file is too large to load' +
                           '(file-size must be less than 10 MB to be edited)',
                'file_size' : e.file_size
            }

            return {
                'payload': json.dumps(data),
                'status': 420
            }
        except:
            self.logger.exception('Lookup file could not be loaded')
            return self.render_error_json('Lookup file could not be loaded', 500)

        return {
            'payload': 'Response',
            'status': 500
        }

    def get_lookup_as_file(self, request_info, lookup_file=None, namespace="lookup_editor",
                           owner=None, lookup_type='csv', **kwargs):
        """
        Provides the lookup file in a way to be downloaded by the browser
        """

        self.logger.info("Exporting lookup, namespace=%s, lookup=%s, type=%s, owner=%s", namespace,
                         lookup_file, lookup_type, owner)

        try:

            # If we are getting the CSV, then just pipe the file to the user
            if lookup_type == "csv":
                with self.lookup_editor.get_lookup(request_info.session_key, lookup_file, namespace, owner) as csv_file_handle:
                    csv_data = csv_file_handle.read()

            # If we are getting a KV store lookup, then convert it to a CSV file
            else:
                rows = self.lookup_editor.get_kv_lookup(lookup_file, namespace, owner)
                csv_data = shortcuts.convert_array_to_csv(rows)

            # Tell the browser to download this as a file
            if lookup_file.endswith(".csv"):
                filename = 'attachment; filename="%s"' % lookup_file
            else:
                filename = 'attachment; filename="%s"' % (lookup_file + ".csv")

            return {
                'payload': json.dumps(csv_data),
                'status': 200,
                'headers': {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': filename
                },
            }

        except IOError:
            return self.render_json([], 404)

        except PermissionDeniedException as exception:
            return self.render_error_json(str(exception), 403)

        return {
            'payload': str(lookup_file),  # Payload of the request.
            'status': 200                 # HTTP status code
        }

    def post_lookup_contents(self, request_info, contents=None, lookup_file=None,
                             namespace="lookup_editor", owner=None, **kwargs):
        """
        Save the JSON contents to the lookup file
        """

        self.logger.info("Saving lookup contents...")

        # Stop if the contents of the lookup was not provided
        if contents is None:
            self.logger.error("No content provided to save")
            return self.render_error_json("No content provided")

        try:

            if owner is None:
                owner = "nobody"

            if namespace is None:
                namespace = "lookup_editor"

            # Check capabilities
            #LookupEditor.check_capabilities(lookup_file, request_info.user, request_info.session_key)

            # Ensure that the file name is valid
            if not shortcuts.is_file_name_valid(lookup_file):
                return self.render_error_json("The lookup filename contains disallowed characters", 400)

            # Determine the final path of the file
            resolved_file_path = self.lookup_editor.resolve_lookup_filename(lookup_file,
                                                                            namespace,
                                                                            owner,
                                                                            session_key=request_info.session_key,
                                                                            throw_not_found=False)

            # Make a backup
            self.lookup_editor.backup_lookup_file(request_info.session_key, lookup_file, namespace, resolved_file_path, owner)

            # Parse the JSON
            parsed_contents = json.loads(contents)

            # Create the temporary file
            temp_file_handle = get_temporary_lookup_file()

            # This is a full path already; no need to call make_splunkhome_path().
            temp_file_name = temp_file_handle.name

            # Make the lookups directory if it does not exist
            destination_lookup_full_path = shortcuts.make_lookup_filename(lookup_file, namespace, owner)
            self.logger.debug("destination_lookup_full_path=%s", destination_lookup_full_path)
            destination_lookup_path_only, _ = os.path.split(destination_lookup_full_path)

            try:
                os.makedirs(destination_lookup_path_only, 0755)
                os.chmod(destination_lookup_path_only, 0755)
            except OSError:
                # The directory already existed, no need to create it
                self.logger.debug("Destination path of lookup already existed, no need to create it; destination_lookup_path=%s", destination_lookup_path_only)

            # Write out the new file to a temporary location
            try:
                if temp_file_handle is not None and os.path.isfile(temp_file_name):

                    csv_writer = csv.writer(temp_file_handle, lineterminator='\n')

                    for row in parsed_contents:

                        if not self.lookup_editor.is_empty(row): # Prune empty rows
                            csv_writer.writerow(row)

            finally:
                if temp_file_handle is not None:
                    temp_file_handle.close()

            # Determine if the lookup file exists, create it if it doesn't
            if resolved_file_path is None:
                shutil.move(temp_file_name, destination_lookup_full_path)
                self.logger.info('Lookup created successfully, user=%s, namespace=%s, lookup_file=%s, path="%s"', request_info.user, namespace, lookup_file, destination_lookup_full_path)

                # If the file is new, then make sure that the list is reloaded so that the editors
                # notice the change
                SplunkLookupTableFile.reload(session_key=request_info.session_key)

            # Edit the existing lookup otherwise
            else:

                try:
                    if not shortcuts.is_lookup_in_users_path(resolved_file_path) or owner == 'nobody':
                        update_lookup_table(filename=temp_file_name,
                                            lookup_file=lookup_file,
                                            namespace=namespace,
                                            owner="nobody",
                                            key=request_info.session_key)
                    else:
                        update_lookup_table(filename=temp_file_name,
                                            lookup_file=lookup_file,
                                            namespace=namespace,
                                            owner=owner,
                                            key=request_info.session_key)

                except AuthorizationFailed as exception:
                    return self.render_error_json(str(exception))

                self.logger.info('Lookup edited successfully, user=%s, namespace=%s, lookup_file=%s',
                                 request_info.user, namespace, lookup_file)

            # Tell the SHC environment to replicate the file
            try:
                self.lookup_editor.force_lookup_replication(namespace, lookup_file, request_info.session_key)
            except ResourceNotFound:
                self.logger.info("Unable to force replication of the lookup file to other search heads; upgrade Splunk to 6.2 or later in order to support CSV file replication")

            # Everything worked, return accordingly
            return {
                'payload': str(lookup_file),  # Payload of the request.
                'status': 200                 # HTTP status code
            }

        except:
            self.logger.exception("Unable to save the lookup")
            return self.render_error_json("Unable to save the lookup")
